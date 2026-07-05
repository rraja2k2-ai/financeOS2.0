This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment Setup

FinanceOS reads Supabase credentials from `.env.local` at runtime. No credentials are hardcoded in the codebase.

### 1. Create your local environment file

```bash
cp .env.example .env.local
```

### 2. Add Supabase credentials

Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Project Settings** → **API**, then copy:

| Variable                        | Source          |
| ------------------------------- | --------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Project URL     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |

Update `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Verify the connection

```bash
npm run db:verify
```

A successful run prints:

```text
[FinanceOS] Supabase connection verified successfully.
  URL: https://your-project-ref.supabase.co
```

If variables are missing or invalid, the app and verification script fail with a clear `[FinanceOS]` error message.

### Supabase architecture

| Layer    | Path                     | Purpose                                                  |
| -------- | ------------------------ | -------------------------------------------------------- |
| Config   | `config/env.ts`          | Validates required environment variables                 |
| Config   | `config/supabase.ts`     | Exposes validated Supabase settings                      |
| Clients  | `lib/supabase/client.ts` | Browser Supabase client                                  |
| Clients  | `lib/supabase/server.ts` | Server Supabase client (SSR)                             |
| Database | `lib/database/`          | Reusable connection entry points for future repositories |

Use `getBrowserDatabase()` in Client Components and `getServerDatabase()` in Server Components, Server Actions, and route handlers.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

Set the same `NEXT_PUBLIC_SUPABASE_*` variables in your Vercel project settings before deploying.
