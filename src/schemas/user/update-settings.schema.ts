import z from 'zod'

export const updateSettingsSchema = z.object({
  language: z.enum(['en', 'vi', 'ru', 'zh']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
})

export type UpdateSettingsDTO = z.infer<typeof updateSettingsSchema>