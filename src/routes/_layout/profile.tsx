import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { useState } from 'react'
import { db } from '#/lib/db'
import { auth } from '#/lib/auth'
import { authMiddleware } from '#/middleware/auth'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Loader2, User, Lock, Shield } from 'lucide-react'
import { getInitials, getErrorMessage } from '@/lib/utils'
import { z } from 'zod'

// ── Validation ────────────────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
})

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return {
      user: {
        id: context.user.id,
        name: context.user.name,
        email: context.user.email,
      },
      roles: context.roles.map((r) => ({
        name: r.name,
        branchName: r.branchName,
      })),
    }
  })

const updateProfile = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((data: { name: string; email: string }) => {
    const parsed = updateProfileSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ context, data }) => {
    const existing = await db.user.findFirst({
      where: { email: data.email, NOT: { id: context.user.id } },
    })
    if (existing) throw new Error('This email is already in use.')

    await db.user.update({
      where: { id: context.user.id },
      data: { name: data.name, email: data.email },
    })

    return { success: true }
  })

const updatePassword = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((data: { currentPassword: string; newPassword: string; confirmPassword: string }) => {
    const parsed = updatePasswordSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ context, data }) => {
    const account = await db.account.findFirst({
      where: { userId: context.user.id, providerId: 'credential' },
    })
    if (!account?.password) throw new Error('No password account found.')

    const valid = await verifyPassword({
      hash: account.password,
      password: data.currentPassword,
    })
    if (!valid) throw new Error('Current password is incorrect.')

    const hashed = await hashPassword(data.newPassword)

    await db.account.update({
      where: { id: account.id },
      data: { password: hashed },
    })

    // Invalidate all other sessions for this user
    const headers = getRequestHeaders()
    const currentSession = await auth.api.getSession({ headers })
    if (currentSession) {
      await db.session.deleteMany({
        where: {
          userId: context.user.id,
          NOT: { id: currentSession.session.id },
        },
      })
    }

    return { success: true }
  })

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/profile')({
  loader: () => getPageData(),
  component: ProfilePage,
})

// ── Main Page ─────────────────────────────────────────────────────────────────

function ProfilePage() {
  const { user, roles } = Route.useLoaderData()
  const router = useRouter()

  // Profile form state
  const [profileForm, setProfileForm] = useState({
    name: user.name,
    email: user.email,
  })
  const [profilePending, setProfilePending] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState(false)

  // Password form state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [passwordPending, setPasswordPending] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  async function handleProfileSubmit() {
    setProfileError(null)
    setProfileSuccess(false)
    setProfilePending(true)
    try {
      await updateProfile({ data: profileForm })
      setProfileSuccess(true)
      router.invalidate()
    } catch (e: unknown) {
      setProfileError(getErrorMessage(e, 'Failed to update profile.'))
    } finally {
      setProfilePending(false)
    }
  }

  async function handlePasswordSubmit() {
    setPasswordError(null)
    setPasswordSuccess(false)
    setPasswordPending(true)
    try {
      await updatePassword({ data: passwordForm })
      setPasswordSuccess(true)
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (e: unknown) {
      setPasswordError(getErrorMessage(e, 'Failed to update password.'))
    } finally {
      setPasswordPending(false)
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">Manage your account details</p>
      </div>

      {/* Avatar + role summary */}
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <Avatar className="w-16 h-16">
            <AvatarFallback className="bg-primary text-primary-foreground text-xl">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <p className="font-semibold text-lg">{user.name}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <div className="flex flex-wrap gap-1 pt-1">
              {roles.map((r) => (
                <Badge
                  key={`${r.name}-${r.branchName}`}
                  variant="secondary"
                  className="text-xs gap-1"
                >
                  <Shield className="w-3 h-3" />
                  {r.branchName ? `${r.name} · ${r.branchName}` : r.name}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile details */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="w-4 h-4" />
            Personal Information
          </CardTitle>
          <CardDescription>Update your name and email address</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-0 p-4">
          {profileError && (
            <Alert variant="destructive">
              <AlertDescription>{profileError}</AlertDescription>
            </Alert>
          )}
          {profileSuccess && (
            <Alert>
              <AlertDescription>Profile updated successfully.</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input
              value={profileForm.name}
              onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email Address</Label>
            <Input
              type="email"
              value={profileForm.email}
              onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
            />
          </div>
          <Button onClick={handleProfileSubmit} disabled={profilePending} className="w-full">
            {profilePending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
            ) : (
              'Save Changes'
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="w-4 h-4" />
            Change Password
          </CardTitle>
          <CardDescription>Update your login password</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-0 p-4">
          {passwordError && (
            <Alert variant="destructive">
              <AlertDescription>{passwordError}</AlertDescription>
            </Alert>
          )}
          {passwordSuccess && (
            <Alert>
              <AlertDescription>Password updated successfully.</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Current Password</Label>
            <Input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) =>
                setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
              }
            />
          </div>
          <Separator />
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <Input
              type="password"
              placeholder="Min. 8 characters"
              value={passwordForm.newPassword}
              onChange={(e) =>
                setPasswordForm({ ...passwordForm, newPassword: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm New Password</Label>
            <Input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) =>
                setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
              }
            />
          </div>
          <Button onClick={handlePasswordSubmit} disabled={passwordPending} className="w-full">
            {passwordPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</>
            ) : (
              'Update Password'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
