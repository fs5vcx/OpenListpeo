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
  const mb = chunkSizeMB && chunkSizeMB > 0 ? chunkSizeMB : DEFAULT_CHUNK_SIZE_MB
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
// ============================================================

/**
 * 分片上传 - 完整优化版
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

  // 计算哈希（秒传）
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
  setUpload("speed", 0)

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

  const actualChunkSize = initResp.data.chunk_size || chunkSize
  const actualTotal = initResp.data.total_chunks || totalChunks
  const uploadedSet = new Set<number>(initResp.data.uploaded || [])

  // ==================== 局部并发安全的实时速率与进度统计 ====================
  const chunkProgress = new Array(actualTotal).fill(0)
  let lastSpeedCalcTime = Date.now()
  let lastSpeedBytes = 0
  const speedSamples: number[] = []
  let maxProgress = 0

  // 预先填充已经完成的分片进度
  for (const idx of uploadedSet) {
    const start = idx * actualChunkSize
    const end = Math.min(start + actualChunkSize, file.size)
    chunkProgress[idx] = end - start
  }

  // 根据已完成的分片初始化进度
  const initialLoaded = chunkProgress.reduce((a, b) => a + b, 0)
  maxProgress = Math.min(100, Math.floor((initialLoaded / file.size) * 100))
  setUpload("progress", maxProgress)
  lastSpeedBytes = initialLoaded

  const updateChunkProgress = (chunkIndex: number, uploadedBytes: number) => {
    chunkProgress[chunkIndex] = uploadedBytes

    const totalLoaded = chunkProgress.reduce((a, b) => a + b, 0)
    const pct = Math.min(100, Math.floor((totalLoaded / file.size) * 100))
    if (pct > maxProgress) {
      maxProgress = pct
      setUpload("progress", pct)
    }

    const now = Date.now()
    const dt = (now - lastSpeedCalcTime) / 1000

    if (dt >= 0.3) {
      const diff = totalLoaded - lastSpeedBytes
      if (diff > 0) {
        const speed = diff / dt

        speedSamples.push(speed)
        if (speedSamples.length > 8) speedSamples.shift()

        const avgSpeed =
          speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length

        setUpload("speed", Math.round(avgSpeed))
      }
      lastSpeedCalcTime = now
      lastSpeedBytes = totalLoaded
    }
  }
  // ======================================================================

  const uploadOneChunk = async (chunkIndex: number): Promise<void> => {
    if (uploadedSet.has(chunkIndex)) {
      return
    }

    const start = chunkIndex * actualChunkSize
    const end = Math.min(start + actualChunkSize, file.size)
    const chunk = file.slice(start, end)

    let lastErr: Error | null = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const form = new FormData()
        form.append("upload_id", uploadID)
        form.append("chunk_index", String(chunkIndex))
        form.append("chunk", chunk)

        const resp: PartResp = await r.post("/fs/chunk/upload", form, {
          headers: {
            "Content-Type": "application/octet-stream",
            Password: password(),
          },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.lengthComputable) {
              const loaded = progressEvent.loaded
              const chunkUploaded = Math.min(loaded, end - start)
              if (chunkUploaded > chunkProgress[chunkIndex]) {
                updateChunkProgress(chunkIndex, chunkUploaded)
              }
            }
          }
        })

        if (resp.code !== 200) {
          throw new Error(resp.message || `upload chunk ${chunkIndex} failed`)
        }

        updateChunkProgress(chunkIndex, end - start)
        uploadedSet.add(chunkIndex)
        return
      } catch (e: any) {
        lastErr = e
        if (attempt < MAX_RETRIES - 1) {
          chunkProgress[chunkIndex] = 0
          await new Promise((resolve) =>
            setTimeout(resolve, 500 * (attempt + 1)),
          )
        }
      }
    }
    throw lastErr || new Error(`upload chunk ${chunkIndex} failed after retries`)
  }

  // 并发上传
  let nextChunkIndex = 0
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

  setUpload("progress", 100)
  setUpload("status", "success")
}

/**
 * 智能上传：大文件走分片，小文件走 Stream
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
  if (file.size > threshold) {
    return ChunkedUpload(
      uploadPath,
      file,
      setUpload,
      asTask,
      overwrite,
      rapid,
    ) as any
  }
  // 小文件用 Stream 上传
  const { StreamUpload } = await import("./stream")
  return StreamUpload(uploadPath, file, setUpload, asTask, overwrite, rapid)
}
