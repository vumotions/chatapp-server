import { v2 as cloudinary } from 'cloudinary'

// Configuration
cloudinary.config({
  cloud_name: 'dka6swfxq',
  api_key: '631323998867879',
  api_secret: 'ScVXv8yYgbND7g7n8LK61kek9kU'
})

export const cloudinaryInstance = cloudinary
