# Codebase Analysis Report — MIS Enterprise

Date: 2026-02-25

## Summary
- Stack: TanStack Start (React 19, TanStack Router/Query), Vite, Tailwind, Prisma, Better Auth.
- Architecture: File-based routes with server functions for data access and mutations.
- Domain: MIS admin panel with RBAC, user/role/branch/page management, products catalog, and Excel upload pipeline.

## Architecture Overview
- Routing: `src/routes` (file-based), main app under `src/routes/_layout`.
- Auth: Better Auth + Prisma adapter in `src/lib/auth.ts`; API handler `src/routes/api/auth/$.tsx`.
- RBAC: `PagePermission` + `UserRole` aggregated in `src/lib/rbac.ts`.
- Database: Prisma schema in `prisma/schema.prisma` (Postgres).

## Key Flows
- App shell: `src/routes/_layout/route.tsx`
  - Loads session + permissions + pages for sidebar.
  - Uses `authMiddleware` to ensure logged-in session.
- Dashboard: `src/routes/_layout/index.tsx`
  - Shows counts for users/roles/branches and admin/MIS stats.
- Admin CRUD:
  - Users: `src/routes/_layout/users.tsx`
  - Roles/permissions: `src/routes/_layout/roles.tsx`
  - Pages/nav groups: `src/routes/_layout/pages.tsx`
  - Branches: `src/routes/_layout/branches.tsx`
  - Products catalog: `src/routes/_layout/products.tsx`
- Upload pipeline: `src/routes/_layout/upload.tsx`
  - Parses Excel via `xlsx`, previews data, bulk upserts categories/subcategories/products,
    inserts transactions, and records upload batches.

## Data Model Highlights
Auth/RBAC:
- `User`, `Role`, `UserRole`, `PagePermission`, `Session`, `Account`
Navigation:
- `Page`, `NavGroup`
Business:
- `Branch`, `Factory`
- `ProductCategory`, `ProductSubcategory`, `Product`
- `TransactionType`, `Transaction`, `UploadBatch`

## Findings (High Impact)
1) Upload access is admin-only
   - `src/routes/_layout/upload.tsx` uses `adminMiddleware`.
   - Non-admin roles with upload permissions (e.g., MIS) cannot access.

2) Resource mismatch: `products`
   - `src/routes/_layout/roles.tsx` includes `products` in `ALL_RESOURCES`.
   - Seed `ALL_RESOURCES` in `prisma/seed.ts` excludes `products`.
   - Seeded pages do not include `/products`, so nav/permissions are out of sync.

3) User deletion may violate FK constraints
   - `deleteUser` does `db.user.delete`.
   - `UploadBatch` requires `User` and has no `onDelete` cascade.
   - Deleting a user with upload batches likely fails.

4) Access cache not truly request-scoped
   - `src/middleware/auth.ts` uses global `Map` keyed by userId.
   - Cleared by `queueMicrotask`, but concurrent requests can see stale data.

5) Encoding artifacts in UI strings
   - Multiple files include mojibake (`â€”`, `Â©`, `â€¢`).
   - Indicates encoding mismatch; visible in UI.

## Findings (Medium / Low)
- Upload uses one large DB transaction and full in-memory parsing.
  Large files may be slow or memory heavy.
- Upload server function accepts input without strong schema validation.
- No tests found (Vitest configured but no `*.test.*`/`*.spec.*` files).
- `keyfile` / `keyfile.pub` present in repo root — ensure these aren’t sensitive.

## Recommendations (Prioritized)
1) Replace `adminMiddleware` on upload with `resourceMiddleware('upload')`,
   and use `RoleGate` for create/edit/delete actions.
2) Align resource list across UI and seed:
   - Add `products` to seed `ALL_RESOURCES`.
   - Add `/products` page in `pageDefs`.
   - Seed default permissions for products as needed.
3) Decide user deletion behavior and enforce in DB:
   - Either prevent delete when related data exists,
     or set explicit `onDelete` behavior for `UploadBatch`.
4) Replace global access cache with request-scoped storage.
5) Normalize encoding to UTF-8 and fix mojibake strings.
6) Add upload limits, validation, and chunked ingestion for large files.
7) Add tests for auth, RBAC checks, and upload processing.

## Next Steps (If You Want Fixes)
I can implement the high-impact fixes in the codebase. Tell me which to tackle first.
