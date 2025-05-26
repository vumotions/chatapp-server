import z, { ZodIssueCode } from 'zod'

export const updateMyProfileSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(50, 'Name must not exceed 50 characters')
    .optional(),
  username: z
    .string()
    .min(1, 'Username is required')
    .max(50, 'Username must not exceed 50 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores and hyphens')
    .optional(),
  bio: z.string().optional(),
  avatar: z.string().url('Value is not a valid URL').optional(),
  coverPhoto: z.string().url('Value is not a valid URL').optional(),
  day: z.coerce.number().optional(),
  month: z.coerce.number().optional(),
  year: z.coerce.number().optional()
})
.superRefine((data, ctx) => {
  // Kiểm tra tính hợp lệ của ngày sinh (nếu có)
  if (data.day !== undefined && data.month !== undefined && data.year !== undefined) {
    const dob = new Date(data.year, data.month - 1, data.day);
    
    // Kiểm tra ngày hợp lệ
    if (dob.getFullYear() !== data.year || dob.getMonth() !== data.month - 1 || dob.getDate() !== data.day) {
      ctx.addIssue({
        path: ['day'],
        message: 'Invalid date of birth',
        code: ZodIssueCode.custom
      });
    }
  } else if (data.day !== undefined || data.month !== undefined || data.year !== undefined) {
    // Nếu chỉ có một số trường ngày sinh, báo lỗi
    ctx.addIssue({
      path: ['day'],
      message: 'All date fields (day, month, year) must be provided together',
      code: ZodIssueCode.custom
    });
  }
})

export type UpdateMyProfileDTO = z.infer<typeof updateMyProfileSchema>
