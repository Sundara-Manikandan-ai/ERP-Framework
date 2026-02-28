import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Command } from 'cmdk'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { getIcon } from '@/lib/icons'
import { Search } from 'lucide-react'

type PageEntry = {
  resource: string
  label: string
  path: string
  icon: string
  group: string
}

interface CommandPaletteProps {
  pages: PageEntry[]
}

export function CommandPalette({ pages }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleSelect(path: string) {
    setOpen(false)
    router.navigate({ to: path })
  }

  // Group pages
  const groups = new Map<string, PageEntry[]>()
  for (const page of pages) {
    const group = page.group || 'General'
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(page)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden">
        <Command className="border-none">
          <div className="flex items-center border-b px-3">
            <Search className="w-4 h-4 mr-2 shrink-0 text-muted-foreground" />
            <Command.Input
              placeholder="Search pages..."
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>
            {Array.from(groups.entries()).map(([groupName, groupPages]) => (
              <Command.Group key={groupName} heading={groupName} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
                {groupPages.map((page) => {
                  const Icon = getIcon(page.icon)
                  return (
                    <Command.Item
                      key={page.resource}
                      value={`${page.label} ${page.resource}`}
                      onSelect={() => handleSelect(page.path)}
                      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                    >
                      {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
                      {page.label}
                    </Command.Item>
                  )
                })}
              </Command.Group>
            ))}
          </Command.List>
          <div className="border-t px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Press <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">Ctrl+K</kbd> to toggle
            </p>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
