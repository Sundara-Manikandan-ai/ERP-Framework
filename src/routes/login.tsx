import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { signIn } from '#/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, LogIn, Leaf } from 'lucide-react'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()

  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [errors, setErrors]         = useState<{ email?: string; password?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, setIsPending]   = useState(false)

  function validate() {
    const next: typeof errors = {}
    if (!email) next.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Enter a valid email address'
    if (!password) next.password = 'Password is required'
    return next
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    const next = validate()
    if (Object.keys(next).length > 0) { setErrors(next); return }
    setErrors({})
    setIsPending(true)
    const { error } = await signIn.email({ email, password, callbackURL: '/' })
    if (error) {
      setServerError(error.message ?? 'Invalid email or password.')
      setIsPending(false)
      return
    }
    await router.navigate({ to: '/' })
  }

  return (
    <div className="min-h-screen flex bg-background">

      {/* ── Left panel — brand ───────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[42%] flex-col justify-between p-10 relative overflow-hidden"
        style={{ background: 'var(--sidebar)' }}
      >
        {/* Decorative circles */}
        <div
          className="absolute -top-24 -left-24 w-96 h-96 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, oklch(0.60 0.18 160), transparent 70%)' }}
        />
        <div
          className="absolute -bottom-16 -right-16 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, oklch(0.60 0.18 160), transparent 70%)' }}
        />

        {/* Logo */}
        <div className="flex items-center gap-2.5 relative z-10">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg"
            style={{ background: 'oklch(0.52 0.17 160 / 0.25)', border: '1px solid oklch(0.60 0.18 160 / 0.40)' }}
          >
            <Leaf className="w-4 h-4" style={{ color: 'oklch(0.72 0.16 160)' }} />
          </div>
          <span className="font-semibold text-sm" style={{ color: 'oklch(0.92 0.010 160)' }}>
            MIS Enterprise
          </span>
        </div>

        {/* Tagline */}
        <div className="relative z-10 space-y-3">
          <h2
            className="text-2xl font-bold leading-snug"
            style={{ color: 'oklch(0.95 0.008 160)', letterSpacing: '-0.02em' }}
          >
            Your operations,<br />beautifully managed.
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'oklch(0.65 0.025 160)' }}>
            Track sales, manage inventory, and monitor branches — all in one place.
          </p>
        </div>

        {/* Footer */}
        <p className="text-xs relative z-10" style={{ color: 'oklch(0.45 0.020 160)' }}>
          © {new Date().getFullYear()} MIS Enterprise
        </p>
      </div>

      {/* ── Right panel — form ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">

        {/* Mobile logo */}
        <div className="flex items-center gap-2 mb-8 lg:hidden">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg"
            style={{ background: 'oklch(0.50 0.17 160 / 0.12)', border: '1px solid oklch(0.50 0.17 160 / 0.25)' }}
          >
            <Leaf className="w-4 h-4 text-primary" />
          </div>
          <span className="font-semibold text-sm">MIS Enterprise</span>
        </div>

        <div className="w-full max-w-[340px] space-y-5">

          {/* Heading */}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted-foreground">Enter your credentials to access your workspace</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="space-y-4">

            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!errors.email}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!errors.password}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in…</>
                : <><LogIn className="mr-2 h-4 w-4" />Sign in</>
              }
            </Button>

          </form>

          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{' '}
            <Link to="/register" className="font-medium text-foreground hover:underline underline-offset-4">
              Create one
            </Link>
          </p>

        </div>
      </div>
    </div>
  )
}
