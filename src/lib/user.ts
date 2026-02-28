import { z } from 'zod'
import { passwordSchema } from '#/lib/validators'

export const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: passwordSchema,
  role: z.string().min(1, 'Role is required'),
  branchId: z.string().optional(),
})

export type CreateUserInput = z.infer<typeof createUserSchema>