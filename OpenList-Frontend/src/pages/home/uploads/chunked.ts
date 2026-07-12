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

  // ==================== 速率计算优化（全局 + 平滑） ====================
  let completedBytes = 0
  let lastUpdateTime = Date.now()
  let lastUpdateBytes = 0
  const speedHistory: number[] = []

  const updateProgressAndSpeed = (currentBytes: number) => {
    completedBytes = currentBytes
    const pct = Math.min(100, Math.floor((currentBytes / file.size) * 100))
    setUpload("progress", pct)

    const now = Date.now()
    const duration = (now - lastUpdateTime) / 1000

    if (duration > 0.35 && currentBytes > lastUpdateBytes) {
      let speed = (currentBytes - lastUpdateBytes) / duration

      // 移动平均平滑
      speedHistory.push(speed)
      if (speedHistory.length > 8) speedHistory.shift()
      const avgSpeed = speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length

      setUpload("speed", Math.round(avgSpeed))
      lastUpdateTime = now
      lastUpdateBytes = currentBytes
    }
  }
  // ============================================================

  const uploadOneChunk = async (chunkIndex: number): Promise<void> => {
    if (uploadedSet.has(chunkIndex)) {
      const start = chunkIndex * actualChunkSize
      const end = Math.min(start + actualChunkSize, file.size)
      updateProgressAndSpeed(completedBytes + (end - start))
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
            Password: password(),
          },
        })

        if (resp.code !== 200) {
          throw new Error(resp.message || `upload chunk ${chunkIndex} failed`)
        }

        updateProgressAndSpeed(completedBytes + (end - start))
        uploadedSet.add(chunkIndex)
        return
      } catch (e: any) {
        lastErr = e
        if (attempt < MAX_RETRIES - 1) {
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
