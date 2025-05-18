import { cloudinaryInstance } from '~/config/cloudinary'

class UploadService {
  async uploadToCloudinary(file: Express.Multer.File, folder: string): Promise<any> {
    try {
      // Chuyển đổi file buffer thành base64
      const fileBase64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
      
      // Upload lên Cloudinary
      const result = await new Promise((resolve, reject) => {
        cloudinaryInstance.uploader.upload(
          fileBase64,
          {
            folder: folder,
            resource_type: 'auto' // Tự động phát hiện loại tài nguyên (image/video)
          },
          (error, result) => {
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
    } catch (error) {
      console.error('Error in uploadToCloudinary:', error)
      throw new Error(`Error uploading to Cloudinary: ${error.message}`)
    }
  }

  async uploadFiles(files: Express.Multer.File[]): Promise<Array<{ url: string, type: string, public_id: string }>> {
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
    } catch (error) {
      console.error('Error uploading files:', error)
      throw new Error(`Failed to upload files: ${error.message}`)
    }
  }
}

const uploadService = new UploadService()
export default uploadService
