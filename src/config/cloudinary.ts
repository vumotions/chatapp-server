import { v2 as cloudinary } from 'cloudinary'
import { cloudinaryConfig } from './cloudinary.config'

// Cấu hình Cloudinary với giá trị cố định
cloudinary.config(cloudinaryConfig)

console.log('Cloudinary configuration:', {
  cloud_name: cloudinaryConfig.cloud_name,
  api_key: '****', // Ẩn api_key thực tế
  api_secret: '****' // Ẩn api_secret thực tế
})

export const cloudinaryInstance = cloudinary
