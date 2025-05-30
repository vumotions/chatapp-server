import { v2 as cloudinary } from 'cloudinary'
import { env } from '~/config/env'

class UploadService {
  constructor() {
    // Cấu hình Cloudinary
    cloudinary.config({
      cloud_name: env.CLOUDINARY_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true
    })
  }

  async uploadToCloudinary(file: Express.Multer.File, folder: string): Promise<any> {
    const fileBase64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`

    // Upload lên Cloudinary
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        fileBase64,
        {
          folder: folder,
          resource_type: 'auto' // Tự động phát hiện loại tài nguyên (image/video)
        },
        (error: any, result: any) => {
          if (error) {
            console.error('Cloudinary upload error:', error)
            reject(error)
          } else {
            resolve(result)
          }
        }
      )
    })

    return result
  }

  async uploadFiles(
    files: Express.Multer.File[]
  ): Promise<Array<{ url: string; type: string; public_id: string }>> {
    if (!files || files.length === 0) {
      return []
    }

    try {
      const uploadPromises = files.map(async (file) => {
        try {
          // Phân loại file dựa trên MIME type
          let fileType = 'other'

          if (file.mimetype.startsWith('image/')) {
            fileType = 'image'
          } else if (file.mimetype.startsWith('video/')) {
            fileType = 'video'
          } else if (file.mimetype.startsWith('audio/')) {
            fileType = 'audio'
          } else if (file.mimetype.includes('pdf')) {
            fileType = 'pdf'
          } else if (file.mimetype.includes('word') || file.mimetype.includes('document')) {
            fileType = 'document'
          } else if (file.mimetype.includes('excel') || file.mimetype.includes('spreadsheet')) {
            fileType = 'spreadsheet'
          } else if (file.mimetype.includes('text/')) {
            fileType = 'text'
          }

          // Xác định folder dựa trên loại file
          const folder = `posts/${fileType}s`

          const result = await this.uploadToCloudinary(file, folder)

          // Đảm bảo trả về đúng định dạng
          return {
            url: result.secure_url,
            type: fileType,
            public_id: result.public_id
          }
        } catch (fileError) {
          console.error('Error uploading individual file:', fileError)
          throw fileError
        }
      })

      const results = await Promise.all(uploadPromises)
      console.log('Upload results:', JSON.stringify(results, null, 2))
      return results
    } catch (error: any) {
      throw new Error(`Failed to upload files: ${error?.message}`)
    }
  }

  // Thêm phương thức xóa file từ Cloudinary
  async deleteFile(publicId: string): Promise<any> {
    if (!publicId) {
      throw new Error('Public ID is required to delete file')
    }

    try {
      // Xóa file từ Cloudinary
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.destroy(
          publicId,
          { resource_type: 'auto' }, // Tự động phát hiện loại tài nguyên
          (error: any, result: any) => {
            if (error) {
              console.error('Cloudinary delete error:', error)
              reject(error)
            } else {
              resolve(result)
            }
          }
        )
      })

      console.log('File deleted from Cloudinary:', publicId, result)
      return result
    } catch (error: any) {
      console.error(`Failed to delete file with public ID ${publicId}:`, error)
      throw new Error(`Failed to delete file: ${error.message}`)
    }
  }
}

const uploadService = new UploadService()
export default uploadService
