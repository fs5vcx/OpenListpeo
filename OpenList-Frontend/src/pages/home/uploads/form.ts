import { password } from "~/store"
import { EmptyResp } from "~/types"
import { r } from "~/utils"
import { SetUpload, Upload } from "./types"
import { calculateHash } from "./util"

export const FormUpload: Upload = async (
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  asTask = false,
  overwrite = false,
  rapid = false,
): Promise<void> => {
  let oldTimestamp = Date.now()
  let oldLoaded = 0

  const form = new FormData()
  form.append("file", file)

  let headers: { [k: string]: any } = {
    "File-Path": encodeURIComponent(uploadPath),
    "As-Task": asTask,
    "Content-Type": "multipart/form-data",
    "Last-Modified": file.lastModified,
    Password: password(),
    Overwrite: overwrite.toString(),
  }

  if (rapid) {
    setUpload("status", "hashing")
    const { md5, sha1, sha256 } = await calculateHash(file, (p) => {
      setUpload("progress", p | 0)
    })
    headers["X-File-Md5"] = md5
    headers["X-File-Sha1"] = sha1
    headers["X-File-Sha256"] = sha256
  }

  setUpload("status", "uploading")

  const resp: EmptyResp = await r.put("/fs/form", form, {
    headers: headers,
    onUploadProgress: (progressEvent: any) => {
      if (!progressEvent.lengthComputable) return

      const loaded = progressEvent.loaded
      const total = progressEvent.total || file.size
      const complete = Math.min(100, Math.floor((loaded / total) * 100))

      setUpload("progress", complete)

      const now = Date.now()
      const duration = (now - oldTimestamp) / 1000

      // ✅ FIX: 降低阈值从 >1s 到 >0.3s，提高速度计算灵敏度
      if (duration > 0.3 && loaded > oldLoaded) {
        const speed = (loaded - oldLoaded) / duration
        const remain = total - loaded
        const remainTime = remain / speed
        setUpload("speed", Math.round(speed))

        oldTimestamp = now
        oldLoaded = loaded
      }

      if (complete === 100) {
        setUpload("status", "backending")
      }
    },
  })

  if (resp.code === 200) {
    return
  } else {
    throw new Error(resp.message)
  }
}
