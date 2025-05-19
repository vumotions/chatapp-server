import { Request, Response } from 'express'
import { AppSuccess } from '~/models/success.model'
import uploadService from '~/services/upload.service'

class UploadController {
  async uploadFiles(req: Request, res: Response): Promise<any> {
    console.log('Upload controller called')
    console.log('Request files:', req.files)
    
    const files = req.files as Express.Multer.File[]
    
    if (!files || files.length === 0) {
      console.log('No files received in controller')
      return res.json(
        new AppSuccess({
          message: 'No files to upload',
          data: { urls: [] }
        })
      )
    }
    
    // Upload files và nhận về mảng đối tượng media
    const uploadedFiles = await uploadService.uploadFiles(files)
    console.log('Files uploaded successfully:', uploadedFiles)

    res.json(
      new AppSuccess({
        message: 'Files uploaded successfully',
        data: {
          files: uploadedFiles,
          urls: uploadedFiles.map(file => file.url)
        }
      })
    )
    return
  }
}

const uploadController = new UploadController()
export default uploadController

