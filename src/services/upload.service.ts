import { cloudinaryInstance } from '~/config/cloudinary'

class UploadService {
  async uploadFiles(files: Express.Multer.File[]) {
    const res = await Promise.all(
      files.map(async (file) => {
        const base64Data = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
        const result = await cloudinaryInstance.uploader.upload(base64Data, {
          resource_type: 'auto',
          folder: 'posts'
        })
        return {
          type: result.resource_type,
          url: result.secure_url,
          public_id: result.public_id
        }
      })
    )
    return res
  }
}

const uploadService = new UploadService()
export default uploadService
