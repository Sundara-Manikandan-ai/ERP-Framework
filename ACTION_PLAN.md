# MIS Enterprise ERP - Deep Analysis & Action Plan

## Overview
Comprehensive analysis of the MIS Enterprise ERP codebase covering security, data integrity, performance, missing features, and code quality.

---

## PRIORITY 1: Security Fixes (Critical)

### 1.1 Reduce Session Lifetime
- **File**: `src/lib/auth.ts` (line ~28)
- **Issue**: Session `expiresIn` set to 7 days — too long for sensitive ERP data
- **Fix**: Change to 8 hours (`60 * 60 * 8`)
- **Impact**: All active sessions expire sooner; users re-login daily

### 1.2 Fix Password Validation Inconsistency
- **File**: `src/lib/validators.ts` (line ~52)
- **Issue**: `createUserSchema` only requires `.min(8)` while `passwordSchema` enforces uppercase, lowercase, digit, special char. Admin-created users bypass strong password policy.
- **Fix**: Use `passwordSchema` in `createUserSchema` instead of plain `.min(8)`

### 1.3 Restrict Open Registration
- **File**: `src/routes/register.tsx`
- **Issue**: Anyone can create an account with no restrictions
- **Options**:
  - Add admin approval workflow (new users get `pending` status)
  - Add invite code requirement
  - Disable registration entirely (admin creates all users)
- **Recommended**: Disable public registration; admin creates users via user management

### 1.4 Fix Race Condition on Role Update
- **File**: `src/routes/_layout/users.tsx` (lines ~187-207)
- **Issue**: `deleteMany()` removes all user roles before `create()` adds new one. If create fails, user has zero roles (locked out).
- **Fix**: Wrap in `$transaction()` — create new role first, then delete old ones

### 1.5 Upload Branch Authorization
- **File**: `src/routes/_layout/upload.tsx` (lines ~96-139)
- **Issue**: Area Managers can upload data to any branch, not just their assigned ones
- **Fix**: In `processUpload`, validate that `branchId` is in user's `branchIds` array (unless admin)

### 1.6 Add IP-Based Rate Limiting on Login
- **File**: `src/routes/login.tsx`, `src/lib/auth.ts`
- **Issue**: Only per-account lockout exists. Attacker can brute-force multiple accounts from same IP.
- **Fix**: Track failed attempts per IP in memory (Map with TTL) or use `LoginEvent` table. Block IP after 20 failed attempts across any account within 15 minutes.

---

## PRIORITY 2: Data Integrity Fixes (High)

### 2.1 Prevent Last Admin Deletion
- **File**: `src/routes/_layout/users.tsx` (line ~178)
- **Issue**: Can delete a user with ADMIN role even if they're the only admin
- **Fix**: Before deletion, count users with ADMIN role type. If count <= 1 and target user is admin, reject.

### 2.2 Fix Batch Replace Race Condition
- **File**: `src/routes/_layout/upload.tsx` (lines ~168-177)
- **Issue**: When `replaceExisting: true`, old batches deleted before new ones created. If creation fails mid-way, data is permanently lost.
- **Fix**: Wrap delete + create in single `$transaction()`. Create new batch first, delete old only on success.

### 2.3 Settings Value Validation
- **File**: `src/routes/_layout/settings.tsx` (lines ~33-41)
- **Issue**: `updateSetting()` accepts any string for any key. No type/format validation.
- **Fix**: Create a settings schema map in `src/lib/validators.ts` with Zod validators per key. Validate before saving.

### 2.4 Centralize ALL_RESOURCES Constant
- **Files**: `prisma/seed.ts` (line 11), `src/routes/_layout/roles.tsx` (line 78)
- **Issue**: Resource list duplicated in multiple files — easy to get out of sync
- **Fix**: Create `src/lib/constants.ts` with single `ALL_RESOURCES` export. Import everywhere.

### 2.5 Atomic User Role Assignment
- **File**: `src/routes/_layout/users.tsx`
- **Issue**: Role deletion and creation not atomic
- **Fix**: Use Prisma `$transaction` for all role changes (covered by 1.4)

### 2.6 Input Sanitization
- **Files**: All route files with create/update operations
- **Issue**: Name fields not trimmed — "Branch A" and "Branch A " treated as different
- **Fix**: Add `.trim()` to all Zod string schemas for name/title fields

---

## PRIORITY 3: Performance Improvements (Medium)

### 3.1 Add Server-Side Pagination
- **Files**: `users.tsx`, `branches.tsx`, `audit-logs.tsx`, `error-logs.tsx`, `products.tsx`
- **Issue**: All queries load entire dataset. Will degrade with 10k+ records.
- **Fix**: Add `skip`/`take` params to server functions. Add pagination controls to TanStack Table instances.

### 3.2 Cache User Permissions in Session
- **File**: `src/lib/rbac.ts`
- **Issue**: `getUserAccess()` queries DB on every single request (roles + permissions join)
- **Fix**: Cache permission result with 5-minute TTL. Invalidate on role/permission change.

### 3.3 Debounce Idle Timeout Events
- **File**: `src/hooks/useIdleTimeout.ts`
- **Issue**: mousemove, click, scroll, keydown events fire timer reset with no throttling
- **Fix**: Add 1-second debounce/throttle on the activity handler

### 3.4 Make Constants Configurable via AppSetting
- **Files**: `src/lib/auth.ts`, `src/hooks/useIdleTimeout.ts`
- **Issue**: Hardcoded values — 30min idle, 5 failed attempts, 15min lockout
- **Fix**: Read from `AppSetting` table at startup. Fall back to defaults.

### 3.5 Lazy Load Archived Records
- **File**: `src/components/shared/ArchivedRecordsDrawer.tsx`
- **Issue**: All archived records loaded when drawer opens, even with 1000+ records
- **Fix**: Add pagination inside the drawer

---

## PRIORITY 4: Missing ERP Features (Enhancement)

### 4.1 Export Functionality (CSV/Excel)
- Add export button to all data tables
- Use `xlsx` library (already used for upload parsing)
- Export filtered/selected rows or full dataset

### 4.2 Advanced Filtering
- Date range pickers for transaction-related tables
- Status/type dropdowns for filtered views
- Column-level filters on TanStack Table

### 4.3 Bulk Operations
- Add row selection checkboxes to tables
- Bulk delete, bulk archive, bulk export actions
- Confirmation dialog for destructive bulk ops

### 4.4 Dashboard Improvements
- **File**: `src/routes/_layout/index.tsx`
- Add: recent activity feed, key metrics cards, transaction charts
- Date range selector for metrics
- Quick action buttons (new upload, add user, etc.)

### 4.5 Notification System
- In-app notification bell in header
- Notify on: upload complete, upload errors, role changes, password reset
- Store in DB, mark as read/unread

### 4.6 Upload Approval Workflow
- New status flow: DRAFT → PENDING_REVIEW → APPROVED → PROCESSED
- Reviewer can approve or reject with comments
- Only approved batches get processed into transactions

### 4.7 Inventory/Stock Tracking
- Calculate running stock from transaction history
- Stock-on-hand view per branch + product
- Low stock alerts

### 4.8 Document Attachments
- File upload for receipts/invoices
- Attach to transactions or upload batches
- Store in filesystem or S3-compatible storage

### 4.9 Global Search (Ctrl+K)
- Command palette searching across users, branches, products, transactions
- Use `cmdk` library (common in shadcn projects)

### 4.10 User Preferences
- Dark/light theme toggle
- Timezone selection
- Default branch selection
- Locale/language preference

---

## PRIORITY 5: Code Quality (Low)

### 5.1 Accessibility
- Add `aria-label` to all icon-only buttons
- Add `aria-describedby` to form error messages
- Add `role="status"` to loading spinners
- Add skip-to-content link

### 5.2 Loading States
- Add skeleton loaders to all tables and cards
- Show loading indicator during form submissions

### 5.3 Standardize Error Handling
- Create consistent error response format across all server functions
- Create reusable error toast component
- Log all server errors to ErrorLog table

### 5.4 Structured Logging
- Replace `console.log`/`console.error` with structured logger
- Add request correlation IDs
- Add log levels (debug, info, warn, error)

### 5.5 Health Check Endpoint
- Add `/api/health` route returning DB connection status + app version
- Useful for Docker/K8s health probes

### 5.6 Test Coverage
- Add vitest unit tests for validators, RBAC logic, utility functions
- Add integration tests for server functions
- Add E2E tests for critical flows (login, upload, user CRUD)

### 5.7 Consistent Soft Delete Pattern
- Users use hard delete while branches/factories use soft delete
- Standardize: all entities should use soft delete with restore capability

---

## Verification Plan
- After Priority 1: Test login flow, registration, upload permissions, session expiry
- After Priority 2: Test user CRUD, role assignment, batch upload replace, settings
- After Priority 3: Load test with 10k+ records, verify pagination, check idle timeout
- After Priority 4: Test each new feature independently
- After Priority 5: Run `npm run build`, accessibility audit, run test suite
