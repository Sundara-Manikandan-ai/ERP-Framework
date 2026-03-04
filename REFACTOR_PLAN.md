# DRY Refactor Execution Plan

## Why This Refactor

The 5 main CRUD pages (`branches`, `factories`, `transaction-types`, `users`, `roles`) share **~40-50% identical code**. This creates maintenance burden — a bug fix or style change must be applied in 5 places. This refactor extracts shared patterns into reusable components and helpers.

### What's Duplicated

| Pattern | Where | ~Lines duplicated |
|---------|-------|-------------------|
| Sortable column header (Button + ArrowUp/Down/UpDown) | ~4 columns × 5 pages = 20 instances | ~120 lines |
| Desktop table rendering (hidden md:block + Table) | 5 pages | ~170 lines |
| Mobile card list (md:hidden + flex col) | 5 pages | ~200 lines |
| Pagination (Page X of Y + prev/next) | 5 pages | ~65 lines |
| Toolbar (search + export + column visibility) | 5 pages | ~175 lines |
| Soft-delete server handler (count deps → fetch old → update → audit) | 5 pages | ~100 lines |
| Restore server handler (fetch → conflict check → restore → audit) | 5 pages | ~75 lines |
| Permanent delete handler (fetch old → delete → audit) | 5 pages | ~50 lines |
| Uniqueness check in create/update (findFirst case-insensitive) | 5 pages | ~50 lines |

**Total duplicated**: ~1,000 lines
**New shared code**: ~200 lines
**Net reduction**: ~800 lines

---

## Pre-requisite: Step 0 — Commit Current Work

**Action**: Commit all uncommitted changes so we have a clean rollback point.

**Why**: Safety net. If any step breaks something, we can `git diff` or revert.

**Status**: [x] Done

---

## Phase 1: Create Shared UI Components (Additive — No Existing Files Touched)

These steps only CREATE new files. Nothing can break.

---

### Step 1: Create `src/components/shared/SortableHeader.tsx`

**Action**: Create a new component that renders a sortable column header button.

**Why**: Every TanStack Table page repeats the same 6-line pattern for each sortable column:
```tsx
// BEFORE (repeated ~20 times across codebase):
header: ({ column }) => (
  <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
    Name
    {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 w-3 h-3" />
      : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 w-3 h-3" />
      : <ArrowUpDown className="ml-2 w-3 h-3" />}
  </Button>
)

// AFTER:
header: ({ column }) => <SortableHeader column={column} label="Name" />
```

**Props**:
- `column: Column<any, unknown>` — TanStack Table column instance
- `label: string` — Display text (e.g. "Name", "Created")

**Imports needed**: `Button` from ui/button, `ArrowUp`, `ArrowDown`, `ArrowUpDown` from lucide-react

**Status**: [x] Done

---

### Step 2: Create `src/components/shared/DataTable.tsx`

**Action**: Create a generic component that renders desktop table + mobile cards + pagination.

**Why**: Every CRUD page has ~80 identical lines for:
1. Desktop table (`<div className="hidden md:block">`) with `flexRender` for headers/cells
2. Mobile card list (`<div className="flex flex-col gap-3 md:hidden">`) with iteration + empty state
3. Pagination controls ("Page X of Y" + prev/next buttons)

The only thing that differs per page is the **mobile card content** (each page shows different fields). We handle this with a `mobileCard` render prop.

**Props**:
- `table: Table<T>` — TanStack Table instance (from `useReactTable`)
- `columns: ColumnDef<T, any>[]` — Column definitions (for `colSpan` in empty state)
- `emptyMessage: string` — e.g. "No branches found."
- `mobileCard: (row: T) => ReactNode` — Render prop for each page's unique card layout

**What it renders**:
```
┌─────────────────────────────────┐
│ Desktop (hidden md:block):      │
│  <Table>                        │
│    <TableHeader> ... headers    │
│    <TableBody> ... rows         │
│    Empty state if no rows       │
│  </Table>                       │
├─────────────────────────────────┤
│ Mobile (md:hidden):             │
│  map rows → mobileCard(row)     │
│  Empty state if no rows         │
├─────────────────────────────────┤
│ Pagination:                     │
│  "Page 1 of 5"  [<] [>]        │
└─────────────────────────────────┘
```

**Imports needed**: `Table`, `TableHeader`, `TableBody`, `TableHead`, `TableRow`, `TableCell` from ui/table, `Button` from ui/button, `ChevronLeft`, `ChevronRight` from lucide-react, `flexRender` from `@tanstack/react-table`

**Status**: [x] Done

---

### Step 3: Create `src/components/shared/TableToolbar.tsx`

**Action**: Create a toolbar component with search input, export button, and column visibility dropdown.

**Why**: Every CRUD page has ~40 identical lines for this toolbar. The only differences are placeholder text and export configuration.

**Props**:
- `table: Table<T>` — For column visibility toggling
- `globalFilter: string` — Current search value
- `onGlobalFilterChange: (value: string) => void` — Search change handler
- `searchPlaceholder: string` — e.g. "Search branches..."
- `exportFilename: string` — e.g. "branches"
- `exportSheetName: string` — e.g. "Branches"
- `exportData: Record<string, unknown>[]` — Pre-mapped data for export (each page maps differently)

**What it renders**:
```
┌──────────────────────────────────────────────┐
│ [🔍 Search branches...] [📥 Export] [⚙ Cols] │
└──────────────────────────────────────────────┘
```

**Uses**: Existing `ExportButton` from `src/components/shared/ExportButton.tsx`

**Imports needed**: `Input` from ui/input, `Button` from ui/button, `DropdownMenu*` from ui/dropdown-menu, `SlidersHorizontal` from lucide-react, `ExportButton`

**Status**: [x] Done

---

## Phase 2: Create Server-Side Helpers (Additive — No Existing Files Touched)

---

### Step 4: Create `src/lib/crud-helpers.ts`

**Action**: Create server-side helper functions for the repeated CRUD patterns.

**Why**: Every CRUD page repeats identical server handler logic for uniqueness checks, soft-delete with dependency guards, restore with conflict checks, and permanent delete. The only differences are the Prisma model and the specific dependencies to check.

#### 4a. `checkUniqueName(model, name, opts?)`

**Current pattern** (repeated in create/update handlers of all 5 pages):
```tsx
// In createBranch:
const existing = await db.branch.findFirst({
  where: { name: { equals: data.name, mode: 'insensitive' }, deletedAt: null },
})
if (existing) throw new Error('Unable to save. The name may already be in use.')

// In updateBranch (adds NOT clause):
const existing = await db.branch.findFirst({
  where: { name: { equals: data.name, mode: 'insensitive' }, NOT: { id: data.id }, deletedAt: null },
})
```

**New helper**:
```tsx
async function checkUniqueName(
  model: any,           // db.branch, db.factory, etc.
  name: string,
  opts?: {
    excludeId?: string  // For updates — exclude self
    parentId?: string | null  // For scoped uniqueness (products)
    field?: string      // Defaults to 'name', can be 'email' for users
    softDelete?: boolean // Whether to add deletedAt: null filter (default: true)
    errorMessage?: string
  }
): Promise<void>
```

#### 4b. `softDeleteRecord(model, id, dependencies, context, resource)`

**Current pattern** (repeated in 5 pages):
```tsx
// 1. Count dependencies (parallel)
const [userCount, txCount] = await Promise.all([
  db.userRole.count({ where: { branchId: data.id } }),
  db.transaction.count({ where: { branchId: data.id } }),
])
if (userCount > 0) throw new Error(`Cannot archive — ${userCount} user(s)...`)
if (txCount > 0) throw new Error(`Cannot archive — ${txCount} transaction(s)...`)
// 2. Fetch old (SEPARATE query — wasteful)
const old = await db.branch.findUnique({ where: { id: data.id } })
// 3. Soft delete
await db.branch.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: email } })
// 4. Audit log
logAudit({ ... oldValue: { name: old.name } })
```

**New helper** (with DB optimization — fetches old in parallel with dependency counts):
```tsx
async function softDeleteRecord(
  model: any,
  id: string,
  dependencies: Array<{
    model: any           // db.userRole, db.transaction, etc.
    where: object        // { branchId: id }
    errorTemplate: string // "Cannot archive — {count} user(s) are assigned."
  }>,
  context: { userId: string; userEmail: string },
  resource: string
): Promise<{ success: true }>
```

**DB Optimization**: Currently `findUnique` for old value runs AFTER dependency checks pass. We move it into the same `Promise.all`, saving 1 DB round-trip per archive operation.

#### 4c. `restoreRecord(model, id, context, resource)`

**Current pattern** (repeated in 5 pages — 2 SEQUENTIAL queries):
```tsx
const record = await db.branch.findUnique({ where: { id } })          // Query 1
const conflict = await db.branch.findFirst({                          // Query 2
  where: { name: { equals: record.name, mode: 'insensitive' }, deletedAt: null }
})
```

**New helper** (with DB optimization — parallelizes the 2 queries):
```tsx
async function restoreRecord(
  model: any,
  id: string,
  context: { userId: string; userEmail: string },
  resource: string
): Promise<{ success: true }>
```

**DB Optimization**: Uses `Promise.all` for fetch + conflict check. The conflict check uses a subquery pattern or we fetch first then check — depends on whether we can get the name before the conflict query. Since we need the name for the conflict query, we'll fetch first, THEN check conflict. But we can at least structure it cleanly.

Actually, the correct optimization: we CAN'T fully parallelize because the conflict query needs the record's name. But we can combine into a single flow that's cleaner. The main value here is code dedup, not query optimization.

#### 4d. `permanentDeleteRecord(model, id, context, resource)`

**Current pattern**: fetch old → delete → logAudit (3 identical lines × 5 pages)

**New helper**:
```tsx
async function permanentDeleteRecord(
  model: any,
  id: string,
  context: { userId: string; userEmail: string },
  resource: string
): Promise<{ success: true }>
```

**Status**: [x] Done

---

## Phase 3: Migrate Pages (One at a Time)

Each step modifies ONE file. If something breaks, only that file needs attention.

**For each page, the changes are**:
1. Import shared components (`SortableHeader`, `DataTable`, `TableToolbar`)
2. Import crud helpers (`checkUniqueName`, `softDeleteRecord`, `restoreRecord`, `permanentDeleteRecord`)
3. Replace inline sortable headers → `<SortableHeader>`
4. Extract `mobileCard` render function (move existing card JSX into a function)
5. Replace table+cards+pagination block → `<DataTable>`
6. Replace toolbar block → `<TableToolbar>`
7. Replace server handler bodies → crud helper calls
8. Remove unused imports (ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, SlidersHorizontal, flexRender, Table*, etc.)

---

### Step 5: Migrate `branches.tsx` (simplest — name + address fields)

**Why first**: Simplest CRUD page. If abstractions work here, they'll work everywhere.

**Server function changes**:
- `createBranch` handler: replace `findFirst` uniqueness check → `checkUniqueName(db.branch, data.name)`
- `updateBranch` handler: replace `findFirst` → `checkUniqueName(db.branch, data.name, { excludeId: data.id })`
- `softDeleteBranch` handler: replace entire body → `softDeleteRecord(db.branch, data.id, [...deps], ctx, 'branches')`
- `restoreBranch` handler: replace entire body → `restoreRecord(db.branch, data.id, ctx, 'branches')`
- `permanentDeleteBranch` handler: replace entire body → `permanentDeleteRecord(db.branch, data.id, ctx, 'branches')`

**UI changes**:
- Replace 4 sortable column headers → `<SortableHeader>`
- Add `mobileCard` function (move existing card JSX)
- Replace ~80 lines (table+cards+pagination) → `<DataTable table={table} columns={columns} emptyMessage="No branches found." mobileCard={renderMobileCard} />`
- Replace ~40 lines (toolbar) → `<TableToolbar ... />`

**Verify**: Desktop table, mobile cards, pagination, search, export, column toggle, create, edit, archive, restore, permanent delete all work.

**Status**: [x] Done

---

### Step 6: Migrate `factories.tsx`

**Same as Step 5**, with these differences:
- Has `isActive` toggle — unaffected by helpers
- Dependency checks: transactions, uploadBatches (2 dependencies)

**Status**: [x] Done

---

### Step 7: Migrate `transaction-types.tsx`

**Same as Step 5**, with these differences:
- Has `pairedWith` field and `requiresFactory` boolean
- Create/edit dialogs stay page-specific (pairedWith Select UI)
- Dependency checks: transactions (1 dependency)

**Status**: [x] Done

---

### Step 8: Migrate `roles.tsx`

**Same as Step 5**, with these differences:
- Most complex page — has permissions matrix with checkboxes
- Create/edit dialogs stay FULLY page-specific (permission editor UI)
- Has `invalidateAccessCache()` call after mutations — call this AFTER the helper returns
- `assignRole` server function is unique — stays as-is
- Dependency checks: userRoles (1 dependency)

```tsx
// Example: softDeleteRole handler after refactor
.handler(async ({ data, context }) => {
  const result = await softDeleteRecord(db.role, data.id, [
    { model: db.userRole, where: { roleId: data.id }, errorTemplate: 'Cannot archive — {count} user(s) have this role.' }
  ], { userId: context.user.id, userEmail: context.user.email }, 'roles')
  invalidateAccessCache()  // roles-specific cleanup
  return result
})
```

**Status**: [x] Done

---

### Step 9: Migrate `users.tsx`

**Same as Step 5**, with these differences:
- Uses `email` for uniqueness instead of `name` → `checkUniqueName(db.user, data.email, { field: 'email' })`
- Create dialog is complex (role + branch assignment in transaction) — stays page-specific
- `updateUserRole` is unique — stays as-is
- Has `invalidateAccessCache(userId)` after mutations — call after helper

**Status**: [x] Done

---

## Phase 4: Cleanup & Verification

### Step 10: Final cleanup

**Actions**:
1. Remove unused imports from ALL migrated pages
2. Run TypeScript check: `npx tsc --noEmit`
3. Test each page end-to-end:
   - [ ] branches: create, edit, archive, restore, delete, search, export, column toggle, mobile view
   - [ ] factories: same
   - [ ] transaction-types: same
   - [ ] roles: same + permission matrix
   - [ ] users: same + role assignment
4. Verify no console errors in browser
5. Commit all changes

**Status**: [x] Done

---

## Recovery Guide

If something breaks mid-refactor:

1. **Phase 1 or 2 broke something**: Impossible — these only create new files. Delete the new files to revert.
2. **A page migration broke**: Only that page file changed. `git checkout -- src/routes/_layout/<page>.tsx` to revert that single file. The shared components remain available for the next attempt.
3. **TypeScript errors after migration**: The error will point to the exact file/line. Usually a missing import or wrong prop type.
4. **Runtime error on a page**: Check browser console. Common causes: wrong prop passed to shared component, missing render prop, or server helper receiving wrong model.

## Progress Tracking

- [x] Step 0: Commit current work
- [x] Step 1: SortableHeader.tsx
- [x] Step 2: DataTable.tsx
- [x] Step 3: TableToolbar.tsx
- [x] Step 4: crud-helpers.ts
- [x] Step 5: Migrate branches.tsx
- [x] Step 6: Migrate factories.tsx
- [x] Step 7: Migrate transaction-types.tsx
- [x] Step 8: Migrate roles.tsx
- [x] Step 9: Migrate users.tsx
- [x] Step 10: Final cleanup & verification
