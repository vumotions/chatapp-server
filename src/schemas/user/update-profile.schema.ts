import z from 'zod'

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
    .optional(),
  bio: z.string().optional(),
  avatar: z.string().url('Value is not a valid URL').optional(),
  coverPhoto: z.string().url('Value is not a valid URL').optional(),
  day: z.coerce.number().optional(),
  month: z.coerce.number().optional(),
  year: z.coerce.number().optional()
})

export type UpdateMyProfileDTO = z.infer<typeof updateMyProfileSchema>
