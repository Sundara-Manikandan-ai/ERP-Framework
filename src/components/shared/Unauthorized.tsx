import { Link } from '@tanstack/react-router'
import { ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Unauthorized() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
      <ShieldX className="w-12 h-12 text-muted-foreground/50" />
      <h2 className="text-lg font-semibold">Access Denied</h2>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        You don't have permission to view this page. Contact your administrator
        to request access.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Back to Dashboard</Link>
      </Button>
    </div>
  )
}
