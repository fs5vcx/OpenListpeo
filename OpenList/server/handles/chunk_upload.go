package handles

import (
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	stdpath "path"
	"sort"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/stream"
	"github.com/OpenListTeam/OpenList/v4/internal/task"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pkg/errors"
)

// 默认分片大小
const (
	DefaultChunkSize = int64(10 * 1024 * 1024)
	MinChunkSize     = int64(1 * 1024 * 1024)
	MaxChunkSize     = int64(100 * 1024 * 1024)
	SessionExpire    = 24 * time.Hour
)

// ChunkUploadSession 分片上传会话
type ChunkUploadSession struct {
	UploadID    string
	FilePath    string
	FileName    string
	FileSize    int64
	TotalChunks int
	ChunkSize   int64
	Uploaded    map[int]bool
	TempDir     string
	AsTask      bool
	Overwrite   bool
	HashInfo    utils.HashInfo
	LastActive  time.Time
	mu          sync.Mutex
}

var (
	chunkSessions   = make(map[string]*ChunkUploadSession)
	chunkSessionsMu sync.RWMutex
	sessionCleanerOnce sync.Once
)

func startSessionCleaner() {
	sessionCleanerOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(time.Hour)
			defer ticker.Stop()
			for range ticker.C {
				cleanExpiredSessions()
			}
		}()
	})
}

func cleanExpiredSessions() {
	now := time.Now()
	var expiredIDs []string
	chunkSessionsMu.RLock()
	for id, s := range chunkSessions {
		if now.Sub(s.LastActive) > SessionExpire {
			expiredIDs = append(expiredIDs, id)
		}
	}
	chunkSessionsMu.RUnlock()
	for _, id := range expiredIDs {
		abortSession(id, "expired")
	}
}

func abortSession(uploadID, reason string) {
	chunkSessionsMu.Lock()
	s, ok := chunkSessions[uploadID]
	if ok {
		delete(chunkSessions, uploadID)
	}
	chunkSessionsMu.Unlock()
	if s != nil {
		_ = os.RemoveAll(s.TempDir)
		utils.Log.Infof("chunk upload session %s aborted: %s", uploadID, reason)
	}
}

// ChunkUploadInitReq 初始化请求
type ChunkUploadInitReq struct {
	Path      string `json:"path" form:"path"`
	FileName  string `json:"file_name" form:"file_name"`
	FileSize  int64  `json:"file_size" form:"file_size"`
	ChunkSize int64  `json:"chunk_size" form:"chunk_size"`
	AsTask    bool   `json:"as_task" form:"as_task"`
	Overwrite bool   `json:"overwrite" form:"overwrite"`
	MD5       string `json:"md5" form:"md5"`
	SHA1      string `json:"sha1" form:"sha1"`
	SHA256    string `json:"sha256" form:"sha256"`
}

// ChunkUploadInit 初始化
func ChunkUploadInit(c *gin.Context) {
	startSessionCleaner()
	var req ChunkUploadInitReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}

	path, err := url.PathUnescape(req.Path)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if path == "" {
		common.ErrorStrResp(c, "path is required", 400)
		return
	}

	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	path, err = user.JoinPath(path)
	if err != nil {
		common.ErrorResp(c, err, 403)
		return
	}

	dirPath := path
	fileName := req.FileName
	if fileName == "" {
		fileName = stdpath.Base(dirPath)
	}
	if err := checkRelativePath(fileName); err != nil {
		common.ErrorResp(c, err, 403)
		return
	}
	dstPath := stdpath.Join(dirPath, fileName)

	// 哈希处理
	h := make(map[*utils.HashType]string)
	if req.MD5 != "" {
		h[utils.MD5] = req.MD5
	}
	if req.SHA1 != "" {
		h[utils.SHA1] = req.SHA1
	}
	if req.SHA256 != "" {
		h[utils.SHA256] = req.SHA256
	}
	hashInfo := utils.NewHashInfoByMap(h)

	// 检查已存在文件
	existing, _ := fs.Get(c.Request.Context(), dstPath, &fs.GetArgs{NoLog: true})
	if existing != nil {
		if hashMatch(existing.GetHash(), hashInfo) {
			common.SuccessResp(c, gin.H{
				"upload_id":    "",
				"rapid_upload": true,
				"reason":       "same_hash",
				"chunk_size":   0,
				"total_chunks": 0,
				"uploaded":     []int{},
			})
			return
		}
		if !req.Overwrite {
			common.ErrorStrResp(c, "file exists", 403)
			return
		}
	}

	// 计算分片大小
	chunkSize := req.ChunkSize
	if chunkSize <= 0 {
		chunkSize = DefaultChunkSize
	}
	if chunkSize < MinChunkSize {
		chunkSize = MinChunkSize
	}
	if chunkSize > MaxChunkSize {
		chunkSize = MaxChunkSize
	}
	if req.FileSize > 0 && chunkSize > req.FileSize {
		chunkSize = req.FileSize
	}
	totalChunks := 1
	if req.FileSize > 0 {
		totalChunks = int((req.FileSize + chunkSize - 1) / chunkSize)
	}

	// 创建临时目录
	tempBase := conf.Conf.TempDir
	if tempBase == "" {
		tempBase = os.TempDir()
	}
	tempDir, err := os.MkdirTemp(tempBase, "chunk_upload_*")
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}

	uploadID := uuid.NewString()
	session := &ChunkUploadSession{
		UploadID:    uploadID,
		FilePath:    dstPath,
		FileName:    fileName,
		FileSize:    req.FileSize,
		TotalChunks: totalChunks,
		ChunkSize:   chunkSize,
		Uploaded:    make(map[int]bool),
		TempDir:     tempDir,
		AsTask:      req.AsTask,
		Overwrite:   req.Overwrite,
		HashInfo:    hashInfo,
		LastActive:  time.Now(),
	}

	chunkSessionsMu.Lock()
	chunkSessions[uploadID] = session
	chunkSessionsMu.Unlock()

	common.SuccessResp(c, gin.H{
		"upload_id":    uploadID,
		"rapid_upload": false,
		"chunk_size":   chunkSize,
		"total_chunks": totalChunks,
		"uploaded":     []int{},
	})
}

func hashMatch(existing utils.HashInfo, incoming utils.HashInfo) bool {
	if len(incoming.Export()) == 0 {
		return false
	}
	for ht := range incoming.All() {
		if existing.GetHash(ht) != "" && existing.GetHash(ht) == incoming.GetHash(ht) {
			return true
		}
	}
	return false
}

// ChunkUploadPart
func ChunkUploadPart(c *gin.Context) {
	uploadID := c.Query("upload_id")
	if uploadID == "" {
		uploadID = c.PostForm("upload_id")
	}
	chunkIndexStr := c.Query("chunk_index")
	if chunkIndexStr == "" {
		chunkIndexStr = c.PostForm("chunk_index")
	}
	if uploadID == "" || chunkIndexStr == "" {
		common.ErrorStrResp(c, "upload_id and chunk_index are required", 400)
		return
	}

	var chunkIndex int
	if _, err := fmt.Sscanf(chunkIndexStr, "%d", &chunkIndex); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}

	chunkSessionsMu.RLock()
	session, ok := chunkSessions[uploadID]
	chunkSessionsMu.RUnlock()
	if !ok {
		common.ErrorStrResp(c, "upload session not found or expired", 404)
		return
	}
	if chunkIndex < 0 || chunkIndex >= session.TotalChunks {
		common.ErrorStrResp(c, "chunk_index out of range", 400)
		return
	}

	session.mu.Lock()
	session.LastActive = time.Now()
	if session.Uploaded[chunkIndex] {
		session.mu.Unlock()
		common.SuccessResp(c, gin.H{"uploaded": true, "skipped": true})
		return
	}
	session.mu.Unlock()

	// 读取分片
	var reader io.Reader
	if file, err := c.FormFile("chunk"); err == nil {
		f, err := file.Open()
		if err != nil {
			common.ErrorResp(c, err, 500)
			return
		}
		defer f.Close()
		reader = f
	} else {
		reader = c.Request.Body
	}

	partPath := filepath.Join(session.TempDir, fmt.Sprintf("chunk_%d.part", chunkIndex))
	finalPath := filepath.Join(session.TempDir, fmt.Sprintf("chunk_%d", chunkIndex))
	f, err := os.Create(partPath)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	if _, err := utils.CopyWithBuffer(f, reader); err != nil {
		_ = f.Close()
		_ = os.Remove(partPath)
		common.ErrorResp(c, err, 500)
		return
	}
	_ = f.Close()
	if err := os.Rename(partPath, finalPath); err != nil {
		_ = os.Remove(partPath)
		common.ErrorResp(c, err, 500)
		return
	}

	session.mu.Lock()
	session.Uploaded[chunkIndex] = true
	uploaded := make([]int, 0, len(session.Uploaded))
	for idx := range session.Uploaded {
		uploaded = append(uploaded, idx)
	}
	session.mu.Unlock()
	sort.Ints(uploaded)

	common.SuccessResp(c, gin.H{"uploaded": true, "skipped": false, "uploaded_chunks": uploaded})
}

type ChunkUploadCompleteReq struct {
	UploadID string `json:"upload_id" form:"upload_id"`
	MD5      string `json:"md5" form:"md5"`
	SHA1     string `json:"sha1" form:"sha1"`
	SHA256   string `json:"sha256" form:"sha256"`
}

// 修复后的 ChunkUploadComplete
func ChunkUploadComplete(c *gin.Context) {
	var req ChunkUploadCompleteReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if req.UploadID == "" {
		common.ErrorStrResp(c, "upload_id is required", 400)
		return
	}

	chunkSessionsMu.RLock()
	session, ok := chunkSessions[req.UploadID]
	chunkSessionsMu.RUnlock()
	if !ok {
		common.ErrorStrResp(c, "upload session not found or expired", 404)
		return
	}

	session.mu.Lock()
	session.LastActive = time.Now()

	missing := []int{}
	for i := 0; i < session.TotalChunks; i++ {
		if !session.Uploaded[i] {
			missing = append(missing, i)
		}
	}
	if len(missing) > 0 {
		session.mu.Unlock()
		common.ErrorResp(c, errors.Errorf("missing chunks: %v", missing), 400)
		return
	}

	if req.MD5 != "" || req.SHA1 != "" || req.SHA256 != "" {
		h := make(map[*utils.HashType]string)
		if req.MD5 != "" {
			h[utils.MD5] = req.MD5
		}
		if req.SHA1 != "" {
			h[utils.SHA1] = req.SHA1
		}
		if req.SHA256 != "" {
			h[utils.SHA256] = req.SHA256
		}
		session.HashInfo = utils.NewHashInfoByMap(h)
	}
	session.mu.Unlock()

	// 合并
	mergedPath := filepath.Join(session.TempDir, "merged")
	mergedFile, err := os.OpenFile(mergedPath, os.O_CREATE|os.O_TRUNC|os.O_RDWR, 0o644)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}

	// 拼接分片
	for i := 0; i < session.TotalChunks; i++ {
		chunkPath := filepath.Join(session.TempDir, fmt.Sprintf("chunk_%d", i))
		cf, err := os.Open(chunkPath)
		if err != nil {
			_ = mergedFile.Close()
			common.ErrorResp(c, err, 500)
			return
		}
		if _, err := utils.CopyWithBuffer(mergedFile, cf); err != nil {
			_ = cf.Close()
			_ = mergedFile.Close()
			common.ErrorResp(c, err, 500)
			return
		}
		_ = cf.Close()
	}

	stat, err := mergedFile.Stat()
	if err != nil {
		_ = mergedFile.Close()
		common.ErrorResp(c, err, 500)
		return
	}
	fileSize := stat.Size()

	if _, err := mergedFile.Seek(0, io.SeekStart); err != nil {
		_ = mergedFile.Close()
		common.ErrorResp(c, err, 500)
		return
	}

	// 构造 FileStream
	dir, name := stdpath.Split(session.FilePath)
	if shouldIgnoreSystemFile(name) {
		_ = mergedFile.Close()
		abortSession(req.UploadID, "system file")
		common.ErrorStrResp(c, errs.IgnoredSystemFile.Error(), 403)
		return
	}

	mimetype := utils.GetMimeType(name)
	s := &stream.FileStream{
		Obj: &model.Object{
			Name:     name,
			Size:     fileSize,
			Modified: time.Now(),
			HashInfo: session.HashInfo,
		},
		Reader:       mergedFile, // 关键修复：不提前关闭
		Mimetype:     mimetype,
		WebPutAsTask: session.AsTask,
	}

	if existing, _ := fs.Get(c.Request.Context(), session.FilePath, &fs.GetArgs{NoLog: true}); existing != nil {
		s.SetExist(existing)
	}

	var t task.TaskExtensionInfo
	if session.AsTask {
		t, err = fs.PutAsTask(c.Request.Context(), dir, s)
	} else {
		err = fs.PutDirectly(c.Request.Context(), dir, s)
	}

	if err != nil {
		_ = mergedFile.Close()
		common.ErrorResp(c, err, 500)
		return
	}

	go abortSession(req.UploadID, "completed")

	if t == nil {
		common.SuccessResp(c, gin.H{"rapid_upload": false})
		return
	}
	common.SuccessResp(c, gin.H{
		"rapid_upload": false,
		"task":         getTaskInfo(t),
	})
}

// ChunkUploadStatus
func ChunkUploadStatus(c *gin.Context) {
	uploadID := c.Query("upload_id")
	if uploadID == "" {
		common.ErrorStrResp(c, "upload_id is required", 400)
		return
	}
	chunkSessionsMu.RLock()
	session, ok := chunkSessions[uploadID]
	chunkSessionsMu.RUnlock()
	if !ok {
		common.ErrorStrResp(c, "upload session not found or expired", 404)
		return
	}
	session.mu.Lock()
	uploaded := make([]int, 0, len(session.Uploaded))
	for idx := range session.Uploaded {
		uploaded = append(uploaded, idx)
	}
	session.mu.Unlock()
	sort.Ints(uploaded)
	common.SuccessResp(c, gin.H{
		"upload_id":    session.UploadID,
		"file_path":    session.FilePath,
		"file_name":    session.FileName,
		"file_size":    session.FileSize,
		"total_chunks": session.TotalChunks,
		"chunk_size":   session.ChunkSize,
		"uploaded":     uploaded,
		"completed":    len(uploaded) == session.TotalChunks,
	})
}

// ChunkUploadAbort
func ChunkUploadAbort(c *gin.Context) {
	uploadID := c.Query("upload_id")
	if uploadID == "" {
		uploadID = c.PostForm("upload_id")
	}
	if uploadID == "" {
		common.ErrorStrResp(c, "upload_id is required", 400)
		return
	}
	abortSession(uploadID, "user aborted")
	common.SuccessResp(c)
}
