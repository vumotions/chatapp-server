import { v2 as cloudinary, ConfigOptions } from 'cloudinary'
import { env } from '~/config/env'

class UploadService {
  cloudinaryInstance: ConfigOptions
  constructor() {
    this.cloudinaryInstance = cloudinary.config({
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
      this.cloudinaryInstance.uploader.upload(
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
          const fileType = file.mimetype.startsWith('image/') ? 'image' : 'video'
          const result = await this.uploadToCloudinary(file, 'posts')

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
}

const uploadService = new UploadService()
export default uploadService
