import { objStore } from "~/store"
import { FormUpload } from "./form"
import { StreamUpload } from "./stream"
import { HttpDirectUpload } from "./direct"
import { SmartUpload, ChunkedUpload } from "./chunked"
import { Upload } from "./types"

type Uploader = {
  upload: Upload
  name: string
  available: () => boolean
}

// All upload methods
const AllUploads: Uploader[] = [
  {
    // Auto: 智能选择，大文件自动分片，小文件走 Stream
    name: "Auto",
    upload: SmartUpload,
    available: () => true,
  },
  {
    name: "HTTP Direct",
    upload: HttpDirectUpload,
    available: () => {
      return objStore.direct_upload_tools?.includes("HttpDirect") || false
    },
  },
  {
    // Chunked: 强制分片上传（不论大小）
    name: "Chunked",
    upload: ChunkedUpload,
    available: () => true,
  },
  {
    name: "Stream",
    upload: StreamUpload,
    available: () => true,
  },
  {
    name: "Form",
    upload: FormUpload,
    available: () => true,
  },
]

export const getUploads = (): Pick<Uploader, "name" | "upload">[] => {
  return AllUploads.filter((u) => u.available())
}
