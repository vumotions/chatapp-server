import multer from 'multer'
import { Request, Response, NextFunction } from 'express'

// Cấu hình multer để cho phép tải lên cả hình ảnh và video
const storage = multer.memoryStorage()
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // Giới hạn kích thước file 10MB
  },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|mp4|mov|avi|pdf|doc|docx|xls|xlsx|txt|csv/
    const mimetype = filetypes.test(file.mimetype)
    const extname = filetypes.test(file.originalname.split('.').pop()?.toLowerCase() || '')

    if (mimetype && extname) {
      return cb(null, true)
    } else {
      cb(new Error('Error: File type not supported! Only jpeg, jpg, png, gif, mp4, mov, avi, pdf, doc, docx, xls, xlsx, txt, csv are allowed.'))
    }
  }
})

const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  upload.array('files', 5)(req, res, (err) => {
    if (err) {
      console.error('Upload middleware error:', err)
      return res.status(400).json({ error: 'Error uploading files: ' + err.message })
    }
    
    // Log thông tin về các file đã tải lên
    const files = req.files as Express.Multer.File[]
    console.log(`Received ${files?.length || 0} files:`, 
      files?.map(f => ({ 
        originalname: f.originalname, 
        mimetype: f.mimetype, 
        size: f.size 
      }))
    )
    
    next()
  })
}

export default uploadMiddleware
