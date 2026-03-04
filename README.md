# MIS Enterprise

Full-stack enterprise management system for multi-branch business operations.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | TanStack Start (React 19, Vite 7, TanStack Router/Query/Table) |
| Database | Prisma 7 + PostgreSQL |
| Auth | Better Auth |
| Styling | Tailwind CSS 4 + Radix UI (shadcn) |
| Validation | Zod |

## Features

- Multi-branch and factory management
- Role-based access control with granular page permissions
- Hierarchical product categories
- Transaction tracking with bulk upload (Excel/CSV)
- Audit logging and error tracking
- Export to Excel/CSV
- Responsive design with mobile views

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database

### Setup

1. Clone the repo:
   ```bash
   git clone <repo-url>
   cd mis-enterprise
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and fill in values:
   ```bash
   cp .env.example .env
   ```

4. Set up your PostgreSQL database and update `DATABASE_URL` in `.env`.

5. Push the schema to the database:
   ```bash
   npx prisma db push
   ```

6. Seed initial data:
   ```bash
   npm run seed
   ```

7. Start the dev server:
   ```bash
   npm run dev
   ```

8. Open http://localhost:3000 and log in with `admin@mis.com` and your `ADMIN_PASSWORD`.

## Environment Variables

See `.env.example` for the full list:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Secret key for Better Auth session signing |
| `BETTER_AUTH_BASE_URL` | Base URL of the app (e.g. `http://localhost:3000`) |
| `ADMIN_PASSWORD` | Password for the seeded admin account |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on port 3000 |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run seed` | Seed database with initial data |
| `npm run test` | Run tests |
