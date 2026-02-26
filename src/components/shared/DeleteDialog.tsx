import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { getErrorMessage } from '@/lib/utils'

export function DeleteDialog({
  title,
  description,
  onConfirm,
  disabled,
  disabledReason,
  buttonSize = 'sm',
}: {
  title: string
  description: React.ReactNode
  onConfirm: () => Promise<void>
  disabled?: boolean
  disabledReason?: string
  buttonSize?: 'sm' | 'default'
}) {
  const [error, setError] = useState<string | null>(null)

  return (
    <AlertDialog onOpenChange={() => setError(null)}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size={buttonSize}
          className="text-destructive hover:text-destructive h-8 w-8 p-0"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {description}
              {disabled && disabledReason && (
                <span className="block mt-2 text-destructive font-medium">
                  ⚠ {disabledReason}
                </span>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={disabled}
            onClick={async () => {
              setError(null)
              try {
                await onConfirm()
              } catch (e: unknown) {
                setError(getErrorMessage(e, 'Failed to delete.'))
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
