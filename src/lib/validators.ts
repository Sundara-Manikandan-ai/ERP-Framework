import { z } from 'zod'

// ── Password ───────────────────────────────────────────────────────────────────
// Single source of truth for password rules — used on register, create user,
// and change password. Update rules here and they apply everywhere.

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(64, 'Password must be at most 64 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character')

// ── Auth Forms ─────────────────────────────────────────────────────────────────

export const registerSchema = z
  .object({
    name:            z.string().trim().min(2, 'Name must be at least 2 characters'),
    email:           z.string().email('Invalid email address'),
    password:        passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path:    ['confirmPassword'],
  })

export const loginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword:     passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path:    ['confirmPassword'],
  })

// ── User Management ────────────────────────────────────────────────────────────

export const createUserSchema = z.object({
  name:     z.string().trim().min(2, 'Name must be at least 2 characters'),
  email:    z.string().email('Invalid email address'),
  password: passwordSchema,
  role:     z.string().min(1, 'Role is required'),
  branchId: z.string().optional(),
})

export type RegisterInput      = z.infer<typeof registerSchema>
export type LoginInput         = z.infer<typeof loginSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type CreateUserInput    = z.infer<typeof createUserSchema>