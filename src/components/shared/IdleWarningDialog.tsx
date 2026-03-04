import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { signOut } from '#/lib/auth-client'
import { useRouter } from '@tanstack/react-router'

interface IdleWarningDialogProps {
  open: boolean
  onStaySignedIn: () => void
  onSignOut: () => void
}

export function IdleWarningDialog({ open, onStaySignedIn, onSignOut }: IdleWarningDialogProps) {
  const router = useRouter()

  async function handleSignOut() {
    onSignOut() // close the dialog immediately
    await signOut()
    await router.navigate({ to: '/login' })
  }

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onSignOut() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still there?</AlertDialogTitle>
          <AlertDialogDescription>
            You've been inactive for a while. For your security, you'll be signed out in
            2 minutes unless you choose to stay signed in.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleSignOut}>
            Sign out now
          </AlertDialogCancel>
          <AlertDialogAction onClick={onStaySignedIn}>
            Stay signed in
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}