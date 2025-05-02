import { v2 as cloudinary } from 'cloudinary'
class UploadService {
  constructor() {
    cloudinary.config({})
  }
}

const uploadService = new UploadService()
export default uploadService
