import { password } from "~/store"
import { EmptyResp } from "~/types"
import { r } from "~/utils"
import { SetUpload, Upload } from "./types"
import { calculateHash } from "./util"

// 默认 10MB；可由 store 中的 uploadConfig.chunkSizeMB 覆盖
const DEFAULT_CHUNK_SIZE_MB = 10
const CONCURRENT_CHUNKS = 3
const MAX_RETRIES = 3

export const getChunkSize = (chunkSizeMB?: number): number => {
  const mb =
    chunkSizeMB && chunkSizeMB > 0 ? chunkSizeMB : DEFAULT_CHUNK_SIZE_MB
  // 限制 1~100MB
  const clamped = Math.max(1, Math.min(100, mb))
  return clamped * 1024 * 1024
}

type InitResp = {
  code: number
  message: string
  data: {
    upload_id: string
    rapid_upload: boolean
    reason?: string
    chunk_size: number
    total_chunks: number
    uploaded: number[]
  }
}

type PartResp = {
  code: number
  message: string
  data: {
    uploaded: boolean
    skipped: boolean
    uploaded_chunks?: number[]
  }
}

/**
 * 分片上传：
 * - 大文件自动分片（默认 10MB，可在 UI 中调整）
 * - 3 并发上传，每个分片失败重试 3 次
 * - init 时传入哈希，命中相同哈希 → 秒传
 * - 同目录已存在同名文件：哈希相同跳过；哈希不同 + overwrite=true 覆盖更新
 * - 支持断点续传（complete 前再次 init 同 path 会复用 upload_id）
 */
export const ChunkedUpload: Upload = async (
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  asTask = false,
  overwrite = false,
  rapid = false,
): Promise<void> => {
  // 从 localStorage 读取用户配置的分片大小（MB）
  const chunkSizeMB = Number(localStorage.getItem("chunk_size_mb")) || undefined
  const chunkSize = getChunkSize(chunkSizeMB)
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize))

  // 计算哈希（秒传必需；用户勾选"尝试秒传"时计算）
  let md5 = ""
  let sha1 = ""
  let sha256 = ""
  if (rapid) {
    setUpload("status", "hashing")
    const hashes = await calculateHash(file, (p) => {
      setUpload("progress", p | 0)
    })
    md5 = hashes.md5
    sha1 = hashes.sha1
    sha256 = hashes.sha256
  }

  setUpload("status", "uploading")
  setUpload("progress", 0)

  // 1. 初始化上传会话
  const initResp: InitResp = await r.post(
    "/fs/chunk/init",
    {
      path: uploadPath,
      file_name: file.name,
      file_size: file.size,
      chunk_size: chunkSize,
      as_task: asTask,
      overwrite: overwrite,
      md5,
      sha1,
      sha256,
    },
    {
      headers: { Password: password() },
    },
  )
  if (initResp.code !== 200) {
    throw new Error(initResp.message || "init failed")
  }

  // 秒传命中
  if (initResp.data.rapid_upload) {
    setUpload("progress", 100)
    setUpload("status", "success")
    return
  }

  const uploadID = initResp.data.upload_id
  if (!uploadID) {
    throw new Error("server did not return upload_id")
  }
  // 实际采用的分片大小（后端可能调整）
  const actualChunkSize = initResp.data.chunk_size || chunkSize
  const actualTotal = initResp.data.total_chunks || totalChunks
  // 已上传分片（断点续传）
  const uploadedSet = new Set(initResp.data.uploaded || [])

  // 2. 并发上传分片
  let nextChunkIndex = 0
  let completedBytes = 0
  let oldTimestamp = Date.now()
  let oldLoaded = 0

  const updateProgress = (deltaBytes: number) => {
    completedBytes += deltaBytes
    const pct = Math.min(100, Math.floor((completedBytes / file.size) * 100))
    setUpload("progress", pct)

    const now = Date.now()
    const duration = (now - oldTimestamp) / 1000
    // ✅ FIX: 降低阈值从 >1s 到 >0.3s，提高速度计算灵敏度
    if (duration > 0.3 && completedBytes > oldLoaded) {
      const loaded = completedBytes - oldLoaded
      const speed = loaded / duration
      setUpload("speed", Math.round(speed))
      oldTimestamp = now
      oldLoaded = completedBytes
    }
  }

  const uploadOneChunk = async (chunkIndex: number): Promise<void> => {
    if (uploadedSet.has(chunkIndex)) {
      // 已上传过，断点续传跳过
      const start = chunkIndex * actualChunkSize
      const end = Math.min(start + actualChunkSize, file.size)
      updateProgress(end - start)
      return
    }
    const start = chunkIndex * actualChunkSize
    const end = Math.min(start + actualChunkSize, file.size)
    const size = end - start
    const chunk = file.slice(start, end)

    let lastErr: Error | null = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await r.put(
          `/fs/chunk/upload?upload_id=${uploadID}&chunk_index=${chunkIndex}`,
          chunk,
          {
            headers: {
              "Content-Type": "application/octet-stream",
            },
            // ✅ FIX: 添加 onUploadProgress 回调，实时上报进度和速度
            onUploadProgress: (progressEvent: any) => {
              if (!progressEvent.lengthComputable) return

              const chunkLoaded = progressEvent.loaded
              const globalLoaded =
                chunkIndex * actualChunkSize + chunkLoaded
              const pct = Math.min(
                100,
                Math.floor((globalLoaded / file.size) * 100),
              )

              setUpload("progress", pct)

              const now = Date.now()
              const dur = (now - oldTimestamp) / 1000

              // ✅ FIX: 降低阈值，确保有速度显示
              if (dur > 0.3 && globalLoaded > oldLoaded) {
                const speed = (globalLoaded - oldLoaded) / dur
                setUpload("speed", Math.round(speed))
                oldTimestamp = now
                oldLoaded = globalLoaded
              }
            },
          },
        )
        return
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e))
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, 500 * (attempt + 1)),
          )
        }
      }
    }
    throw lastErr || new Error(`upload chunk ${chunkIndex} failed after retries`)
  }

  // 简单的并发池
  const workers: Promise<void>[] = []
  for (let w = 0; w < CONCURRENT_CHUNKS; w++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = nextChunkIndex++
          if (idx >= actualTotal) break
          await uploadOneChunk(idx)
        }
      })(),
    )
  }
  await Promise.all(workers)

  // 3. 完成上传
  setUpload("status", "backending")
  const completeResp: EmptyResp = await r.post(
    "/fs/chunk/complete",
    {
      upload_id: uploadID,
      md5,
      sha1,
      sha256,
    },
    {
      headers: { Password: password() },
    },
  )
  if (completeResp.code !== 200) {
    throw new Error(completeResp.message || "complete failed")
  }
}

/**
 * 智能上传：大文件走分片，小文件走 Stream
 * 通过 store 中的 uploadConfig.chunkSizeMB 控制"大文件"阈值（默认 10MB）
 */
export const SmartUpload: Upload = async (
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  asTask = false,
  overwrite = false,
  rapid = false,
): Promise<void> => {
  const threshold = getChunkSize(
    Number(localStorage.getItem("chunk_size_mb")) || undefined,
  )
  if (file.size >= threshold) {
    return ChunkedUpload(
      uploadPath,
      file,
      setUpload,
      asTask,
      overwrite,
      rapid,
    ) as any
  }
  // 小文件用 Stream 上传（更高效）
  const { StreamUpload } = await import("./stream")
  return StreamUpload(uploadPath, file, setUpload, asTask, overwrite, rapid)
}
