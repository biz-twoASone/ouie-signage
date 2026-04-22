# Plan 2 — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a functional Next.js dashboard that lets the tenant owner upload media, manage stores and TVs, compose playlists, schedule dayparting rules, monitor device health, and trigger sync pushes — backed by the Plan 1 Supabase schema and Edge Functions.

**Architecture:** Next.js 15 App Router on Vercel, server-rendered by default with Supabase SSR cookies for auth. Client talks to Supabase-Postgres via `@supabase/ssr` for tenant-scoped reads/writes (RLS enforced); calls the Plan 1 Edge Functions directly for pairing claim and "Sync Now"; uploads media via a new `media-upload-url` Edge Function that mints presigned R2 PUT URLs and creates a pending `media` row. Tenant bootstrap is a Postgres trigger that auto-creates a `tenants` row + `tenant_members` row on first sign-in. Alert emails go through a pg_cron-scheduled Edge Function + Resend.

**Tech Stack:**
- Next.js 15 (App Router) + React 18 + TypeScript strict
- Tailwind CSS + shadcn/ui (component library, copy-paste, Tailwind-based)
- `@supabase/ssr` for auth session + cookies
- `@supabase/supabase-js` for tenant data queries (RLS-enforced)
- React Hook Form + Zod for form state + validation
- `@dnd-kit/sortable` for playlist item drag-reorder
- Playwright for E2E
- pnpm as package manager
- Resend for transactional email (alerts)
- pg_cron (Postgres extension) for scheduled alert checks

---

## Key decisions flagged here (for reviewer context)

1. **Monorepo layout:** dashboard lives at `dashboard/` subdir of this repo. Same git history as `supabase/` (backend) and future `android-tv/` (Plan 3).
2. **Tenant bootstrap = Postgres trigger on `auth.users` insert.** Auto-creates `tenants` + `tenant_members`. Alternative was a server action; trigger is cleaner (can't be forgotten by app code).
3. **Media upload flow = two-phase.** (a) Server inserts "pending" media row + returns presigned R2 PUT URL. (b) Client PUTs directly to R2. (c) Client calls server action to mark media "uploaded" + stamp checksum. Safer than single-phase (no orphaned R2 objects if client disconnects mid-upload).
4. **No video thumbnails in v1.** Use file-type icon + filename + duration (read with `<video>` element client-side after upload). Thumbnail generation server-side is expensive and not worth for 3 stores.
5. **Email via Resend.** De-facto Deno-friendly transactional email. Free tier (3k emails/month) covers alerts comfortably. Alternative: Supabase's built-in auth-email SMTP is tied to auth flows, not transactional.
6. **Dayparting UI = simple form.** Day-of-week dropdown + start/end time pickers + playlist dropdown. No calendar preview in v1.
7. **Data fetching pattern:** Server Components as default with direct `supabase.from()` calls. Client components + Server Actions only where mutation requires optimistic UI. No TanStack Query.
8. **No API route handlers in Next.js.** Mutations go through Server Actions or directly to Supabase Edge Functions. This keeps the code surface minimal.

---

## File structure (post-plan)

```
smart-tv-video-viewer/
├── dashboard/                             # NEW — Next.js app root
│   ├── app/
│   │   ├── layout.tsx                     # root html + Tailwind
│   │   ├── page.tsx                       # redirect / → /app
│   │   ├── login/
│   │   │   └── page.tsx                   # magic-link form
│   │   ├── auth/
│   │   │   └── callback/route.ts          # Supabase OAuth callback
│   │   └── (app)/                         # authenticated shell
│   │       ├── layout.tsx                 # nav + user menu
│   │       ├── page.tsx                   # home (device overview grid)
│   │       ├── stores/
│   │       │   ├── page.tsx               # stores list
│   │       │   ├── new/page.tsx           # create store
│   │       │   └── [id]/page.tsx          # edit store
│   │       ├── devices/
│   │       │   ├── page.tsx               # devices list
│   │       │   ├── pair/page.tsx          # enter pairing code
│   │       │   └── [id]/page.tsx          # device detail
│   │       ├── media/
│   │       │   └── page.tsx               # library + upload
│   │       ├── playlists/
│   │       │   ├── page.tsx               # playlists list
│   │       │   └── [id]/page.tsx          # composer
│   │       ├── device-groups/
│   │       │   ├── page.tsx               # groups list
│   │       │   └── [id]/page.tsx          # group members + assignment
│   │       └── schedules/
│   │           ├── page.tsx               # dayparting rules list
│   │           └── new/page.tsx           # rule form
│   ├── components/
│   │   ├── ui/                            # shadcn/ui generated (button, input, etc.)
│   │   ├── nav.tsx
│   │   ├── user-menu.tsx
│   │   ├── sign-out-button.tsx
│   │   ├── device-status-badge.tsx
│   │   ├── store-form.tsx
│   │   ├── pair-device-form.tsx
│   │   ├── rename-device-form.tsx
│   │   ├── sync-now-button.tsx
│   │   ├── media-uploader.tsx
│   │   ├── media-list.tsx
│   │   ├── playlist-composer.tsx
│   │   ├── sortable-items.tsx
│   │   ├── assign-playlist-form.tsx
│   │   ├── group-members-editor.tsx
│   │   ├── dayparting-rule-form.tsx
│   │   └── ...
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── server.ts                  # createServerClient for RSC + actions
│   │   │   ├── client.ts                  # createBrowserClient for client comps
│   │   │   └── middleware.ts              # session refresh helper
│   │   ├── actions/                       # server actions (mutations)
│   │   │   ├── stores.ts
│   │   │   ├── devices.ts
│   │   │   ├── media.ts
│   │   │   ├── playlists.ts
│   │   │   ├── device-groups.ts
│   │   │   └── dayparting.ts
│   │   ├── types.ts                       # app-level types
│   │   └── utils.ts                       # shadcn cn() + misc
│   ├── middleware.ts                      # route gate + session refresh
│   ├── .env.local.example
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── tsconfig.json
│   ├── components.json                    # shadcn/ui config
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── playwright.config.ts
│   └── e2e/
│       └── happy-path.spec.ts
├── supabase/
│   ├── functions/
│   │   ├── media-upload-url/              # NEW — mint R2 presigned PUT + pending media row
│   │   │   └── index.ts
│   │   └── alerts-device-offline/         # NEW — pg_cron target, Resend email
│   │       └── index.ts
│   └── migrations/
│       ├── 20260422000100_tenant_bootstrap_trigger.sql   # NEW
│       ├── 20260422000200_enable_pg_cron.sql             # NEW
│       └── 20260422000300_alerts_cron_schedule.sql       # NEW
└── ...
```

---

## Conventions

- **All commits are conventional-commits style** with scopes `feat(dash):`, `fix(dash):`, `feat(fn):`, `feat(db):`, `chore(dash):`, `test(dash):`.
- **One commit per task.** If a task touches dashboard + backend, that's still one commit.
- **TDD for Edge Functions.** Same as Plan 1: write Deno test first, implement, test passes, commit. Dashboard UI tasks are NOT TDD — testing dashboard via Playwright (end of plan) is the pragmatic boundary.
- **Server Actions over client mutations** where possible. Client state only when the mutation needs optimistic UI (drag-reorder) or instant feedback (upload progress).
- **`pnpm` is the only package manager.** Commit `pnpm-lock.yaml`. Do NOT mix with npm/yarn.
- **Environment variables on the dashboard side** are prefixed `NEXT_PUBLIC_` only when safe to expose to the browser (URL + anon key). Service-role key stays server-side.
- **Supabase URL and anon key come from `dashboard/.env.local`** during development. In Vercel, set via env var. The `dashboard/.env.local.example` documents the shape (no secrets).

---

## Task 1: Monorepo root — add dashboard package + pnpm workspace

**Files:**
- Create: `dashboard/` (directory)
- Create: `pnpm-workspace.yaml`
- Create: `package.json` at repo root (workspace root)
- Modify: `.gitignore` (ensure `dashboard/node_modules/` and `dashboard/.next/` covered — they already are via root patterns but verify)

- [ ] **Step 1: Verify pnpm is installed**

```bash
pnpm --version
```
Expected: any 8.x or 9.x. If missing, install via `brew install pnpm` (or `corepack enable && corepack prepare pnpm@latest --activate`).

- [ ] **Step 2: Create workspace root**

Create `pnpm-workspace.yaml` at repo root:

```yaml
packages:
  - "dashboard"
```

Create `package.json` at repo root:

```json
{
  "name": "smart-tv-video-viewer",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev": "pnpm --filter dashboard dev",
    "build": "pnpm --filter dashboard build",
    "start": "pnpm --filter dashboard start",
    "lint": "pnpm --filter dashboard lint",
    "test:fn": "deno task test",
    "test:e2e": "pnpm --filter dashboard exec playwright test"
  }
}
```

Create the `dashboard/` directory: `mkdir -p dashboard`

- [ ] **Step 3: Commit**

```bash
git add pnpm-workspace.yaml package.json
git commit -m "chore: init pnpm workspace root with dashboard package"
```

---

## Task 2: Scaffold Next.js app in `dashboard/`

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/next.config.js`
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/app/layout.tsx`
- Create: `dashboard/app/page.tsx`
- Create: `dashboard/app/globals.css`
- Create: `dashboard/.env.local.example`
- Create: `dashboard/.env.local` (local dev only, gitignored)

- [ ] **Step 1: Run Next.js scaffolder with preset options**

From repo root:

```bash
cd dashboard
pnpm create next-app@latest . --typescript --app --tailwind --eslint --src-dir=false --import-alias="@/*" --use-pnpm --no-turbopack
cd ..
```

If it prompts for overwrite on empty dir, accept. This creates `dashboard/package.json`, `tsconfig.json`, `next.config.js`, `tailwind.config.ts`, `postcss.config.js`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`.

- [ ] **Step 2: Simplify `app/page.tsx` to a redirect**

Overwrite `dashboard/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/app");
}
```

- [ ] **Step 3: Create `.env.local.example`**

Create `dashboard/.env.local.example`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Create `dashboard/.env.local` with local Supabase values (recover via `supabase status -o env`):

```
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
```

- [ ] **Step 4: Verify dev server starts**

```bash
cd dashboard && pnpm dev
```
Expected: `Ready` message, `http://localhost:3000`. Visit it in a browser — should 307-redirect to `/app` and then 404 (we haven't built it yet). Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add dashboard/ pnpm-lock.yaml
git commit -m "feat(dash): scaffold Next.js app with App Router + Tailwind"
```

---

## Task 3: Add shadcn/ui

**Files:**
- Create: `dashboard/components.json`
- Create: `dashboard/lib/utils.ts`
- Create: `dashboard/components/ui/button.tsx` (first component to prove setup)

- [ ] **Step 1: Initialize shadcn/ui**

```bash
cd dashboard
pnpm dlx shadcn@latest init --defaults
```

Accept defaults: TypeScript yes, New York style, Slate base color, CSS variables yes. This creates `components.json` and `lib/utils.ts`.

- [ ] **Step 2: Add base components we'll need throughout**

```bash
pnpm dlx shadcn@latest add button input label textarea select dialog form toast table card dropdown-menu badge
```

This writes into `components/ui/`.

- [ ] **Step 3: Smoke-test with a button on the home page**

Edit `dashboard/app/page.tsx` (temporary — we'll replace once auth is in):

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/app");
}
```

Create a quick placeholder at `dashboard/app/app/page.tsx` (we'll replace this too):

```tsx
import { Button } from "@/components/ui/button";

export default function AppHome() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-4">Smart TV Signage</h1>
      <Button>Shadcn button loaded</Button>
    </main>
  );
}
```

Run dev server, visit `http://localhost:3000` → should redirect to `/app` and render the button styled. Ctrl+C.

- [ ] **Step 4: Commit**

```bash
cd ..
git add dashboard/ pnpm-lock.yaml
git commit -m "feat(dash): add shadcn/ui base components"
```

---

## Task 4: Add Supabase SSR client modules

**Files:**
- Create: `dashboard/lib/supabase/server.ts`
- Create: `dashboard/lib/supabase/client.ts`
- Create: `dashboard/lib/supabase/middleware.ts`

- [ ] **Step 1: Install Supabase deps**

```bash
cd dashboard
pnpm add @supabase/ssr @supabase/supabase-js
cd ..
```

- [ ] **Step 2: Write server client helper**

Create `dashboard/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // In Server Components cookies are immutable; middleware refreshes the session.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Write browser client helper**

Create `dashboard/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 4: Write middleware session refresher**

Create `dashboard/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthed = !!user;
  const isPublic =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth");

  if (!isAuthed && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (isAuthed && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  return response;
}
```

- [ ] **Step 5: Wire middleware into Next.js**

Create `dashboard/middleware.ts`:

```ts
import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/
git commit -m "feat(dash): add Supabase SSR client + auth middleware"
```

---

## Task 5: Magic-link login page

**Files:**
- Create: `dashboard/app/login/page.tsx`
- Create: `dashboard/app/auth/callback/route.ts`
- Create: `dashboard/lib/actions/auth.ts`

- [ ] **Step 1: Server action for sending magic link**

Create `dashboard/lib/actions/auth.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export async function sendMagicLink(formData: FormData) {
  const email = formData.get("email") as string;
  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    return { error: "Please enter a valid email address." };
  }
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 2: Login page (Server Component + client form fragment)**

Create `dashboard/app/login/page.tsx`:

```tsx
import { sendMagicLink } from "@/lib/actions/auth";
import { LoginForm } from "./form";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          We'll email you a magic link.
        </p>
        <LoginForm action={sendMagicLink} />
      </div>
    </main>
  );
}
```

Create `dashboard/app/login/form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (formData: FormData) => Promise<{ ok?: boolean; error?: string }>;
};

export function LoginForm({ action }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await action(fd);
          if (r.error) setMsg(`Error: ${r.error}`);
          else setMsg("Check your email for the magic link.");
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send magic link"}
      </Button>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Auth callback route handler**

Create `dashboard/app/auth/callback/route.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
```

- [ ] **Step 4: Smoke test**

```bash
cd dashboard && pnpm dev
```
Visit `http://localhost:3000/login`. Enter an email. Supabase's local dev inbox is Inbucket at `http://127.0.0.1:54324` — open it, find the magic link, click → should redirect to `/app` (which will 404 until we build it in Task 8 — that's fine for now, proves auth works). Ctrl+C.

- [ ] **Step 5: Commit**

```bash
cd ..
git add dashboard/
git commit -m "feat(dash): magic-link login with auth callback"
```

---

## Task 6: Tenant bootstrap Postgres trigger

**Files:**
- Create: `supabase/migrations/20260422000100_tenant_bootstrap_trigger.sql`
- Create: `supabase/tests/tenant_bootstrap.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260422000100_tenant_bootstrap_trigger.sql`:

```sql
-- Auto-create a tenant and tenant_members row on first sign-in. The first user
-- who signs in becomes owner of their own single-tenant workspace. This is the
-- "multi-tenant schema, single-tenant UX" discipline in action: schema allows
-- N tenants; v1 operator just sees their own.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
  display_name text;
begin
  -- Derive a friendly tenant name from the email local-part.
  display_name := split_part(coalesce(new.email, 'user'), '@', 1);

  insert into public.tenants (name)
  values (display_name || '''s workspace')
  returning id into new_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (new_tenant_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Write pgtap test**

Create `supabase/tests/tenant_bootstrap.sql`:

```sql
begin;
select plan(3);

-- Simulate auth.users insert (mimics what Supabase does on sign-up).
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values (
  '00000000-0000-0000-0000-000000000011',
  'newbie@example.com',
  '{}'::jsonb,
  '{}'::jsonb,
  'authenticated',
  'authenticated'
);

select is(
  (select count(*)::int from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = '00000000-0000-0000-0000-000000000011'),
  1,
  'new user has exactly one tenant_members row'
);

select is(
  (select role from public.tenant_members
    where user_id = '00000000-0000-0000-0000-000000000011'),
  'owner',
  'role is owner'
);

select is(
  (select t.name from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = '00000000-0000-0000-0000-000000000011'),
  'newbie''s workspace',
  'tenant name derived from email local-part'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Apply and verify**

```bash
supabase db reset        # clean apply of all migrations
supabase test db         # runs the new test + all prior pgtap tests
```
Expected: all tests pass including the new one.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260422000100_tenant_bootstrap_trigger.sql supabase/tests/tenant_bootstrap.sql
git commit -m "feat(db): tenant auto-bootstrap trigger on auth.users insert"
```

---

## Task 7: App shell — layout + nav + user menu + sign out

**Files:**
- Create: `dashboard/app/(app)/layout.tsx`
- Create: `dashboard/app/(app)/page.tsx` (replace placeholder)
- Create: `dashboard/components/nav.tsx`
- Create: `dashboard/components/user-menu.tsx`
- Create: `dashboard/components/sign-out-button.tsx`
- Create: `dashboard/lib/actions/tenant.ts`

Note the route group `(app)` — the parens mean "don't add to URL", so `(app)/page.tsx` is served at `/app` via a matching folder `app/(app)/` routed from the matcher regex. We also create `app/app/page.tsx` redirect wrapper if needed — but actually Next.js routes `app/(app)/page.tsx` to `/` by default, so we need an explicit `/app` path. Change the structure: use `app/app/` (no parens) instead.

Revised files:
- Create: `dashboard/app/app/layout.tsx`
- Create: `dashboard/app/app/page.tsx`

- [ ] **Step 1: Helper to fetch current tenant context**

Create `dashboard/lib/actions/tenant.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";

export async function getCurrentTenant() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("tenant_members")
    .select("tenant_id, role, tenants(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) return null;
  return {
    user_id: user.id,
    email: user.email,
    tenant_id: data.tenant_id,
    tenant_name: (data.tenants as { name: string } | null)?.name ?? "",
    role: data.role,
  };
}
```

- [ ] **Step 2: App-scoped layout with nav**

Create `dashboard/app/app/layout.tsx`:

```tsx
import { getCurrentTenant } from "@/lib/actions/tenant";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { UserMenu } from "@/components/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold">{tenant.tenant_name}</span>
          <Nav />
        </div>
        <UserMenu email={tenant.email ?? ""} />
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Nav component**

Create `dashboard/components/nav.tsx`:

```tsx
import Link from "next/link";

const items = [
  { href: "/app", label: "Home" },
  { href: "/app/stores", label: "Stores" },
  { href: "/app/devices", label: "Devices" },
  { href: "/app/device-groups", label: "Groups" },
  { href: "/app/media", label: "Media" },
  { href: "/app/playlists", label: "Playlists" },
  { href: "/app/schedules", label: "Schedules" },
];

export function Nav() {
  return (
    <nav className="flex gap-4 text-sm">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="text-muted-foreground hover:text-foreground">
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: User menu + sign-out**

Create `dashboard/components/sign-out-button.tsx`:

```tsx
"use client";

import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { useTransition } from "react";

export function SignOutButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => start(() => signOut())}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
```

Create `dashboard/components/user-menu.tsx`:

```tsx
import { SignOutButton } from "@/components/sign-out-button";

export function UserMenu({ email }: { email: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">{email}</span>
      <SignOutButton />
    </div>
  );
}
```

- [ ] **Step 5: Home page (placeholder device overview)**

Create `dashboard/app/app/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";

export default async function AppHome() {
  const supabase = await createClient();
  const { data: devices } = await supabase
    .from("devices")
    .select("id, name, last_seen_at, store_id, stores(name)")
    .order("name");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Devices</h1>
      {(!devices || devices.length === 0) ? (
        <p className="text-muted-foreground">
          No devices yet. <a href="/app/devices/pair" className="underline">Pair a TV</a> to get started.
        </p>
      ) : (
        <ul className="space-y-2">
          {devices.map((d) => (
            <li key={d.id} className="border rounded p-3 flex justify-between">
              <span>{d.name}</span>
              <span className="text-muted-foreground text-sm">
                {(d.stores as { name: string } | null)?.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Smoke-test**

```bash
cd dashboard && pnpm dev
```
Sign in via magic link (Inbucket at `http://127.0.0.1:54324`). Should land on `/app` showing "No devices yet." Sign out, confirm redirect to `/login`. Ctrl+C.

- [ ] **Step 7: Commit**

```bash
cd ..
git add dashboard/
git commit -m "feat(dash): app shell with nav, user menu, sign-out"
```

---

## Task 8: Stores — list + form

**Files:**
- Create: `dashboard/app/app/stores/page.tsx`
- Create: `dashboard/app/app/stores/new/page.tsx`
- Create: `dashboard/app/app/stores/[id]/page.tsx`
- Create: `dashboard/components/store-form.tsx`
- Create: `dashboard/lib/actions/stores.ts`

- [ ] **Step 1: Server actions for stores**

Create `dashboard/lib/actions/stores.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type StoreInput = {
  name: string;
  timezone: string;
  sync_window_start: string;
  sync_window_end: string;
};

function validate(input: StoreInput): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(input.timezone)) return "Timezone must be an IANA identifier like Asia/Jakarta.";
  if (!/^\d{2}:\d{2}$/.test(input.sync_window_start)) return "Sync start must be HH:MM.";
  if (!/^\d{2}:\d{2}$/.test(input.sync_window_end)) return "Sync end must be HH:MM.";
  return null;
}

export async function createStore(input: StoreInput) {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return { error: "No tenant context." };

  const { error } = await supabase.from("stores").insert({
    tenant_id: tm.tenant_id,
    name: input.name.trim(),
    timezone: input.timezone,
    sync_window_start: input.sync_window_start,
    sync_window_end: input.sync_window_end,
  });
  if (error) return { error: error.message };
  revalidatePath("/app/stores");
  redirect("/app/stores");
}

export async function updateStore(id: string, input: StoreInput) {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { error } = await supabase.from("stores").update({
    name: input.name.trim(),
    timezone: input.timezone,
    sync_window_start: input.sync_window_start,
    sync_window_end: input.sync_window_end,
  }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/stores");
  revalidatePath(`/app/stores/${id}`);
  redirect("/app/stores");
}

export async function deleteStore(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("stores").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/stores");
  redirect("/app/stores");
}
```

- [ ] **Step 2: Store form component (reusable for create + edit)**

Create `dashboard/components/store-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Store = {
  id?: string;
  name: string;
  timezone: string;
  sync_window_start: string;
  sync_window_end: string;
};

type Props = {
  initial?: Store;
  onSubmit: (input: Omit<Store, "id">) => Promise<{ error?: string } | void>;
  submitLabel: string;
};

export function StoreForm({ initial, onSubmit, submitLabel }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input = {
          name: String(fd.get("name") ?? ""),
          timezone: String(fd.get("timezone") ?? ""),
          sync_window_start: String(fd.get("sync_window_start") ?? ""),
          sync_window_end: String(fd.get("sync_window_end") ?? ""),
        };
        start(async () => {
          const r = await onSubmit(input);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
    >
      <Field label="Name" name="name" defaultValue={initial?.name} />
      <Field label="Timezone (IANA)" name="timezone" defaultValue={initial?.timezone ?? "Asia/Jakarta"} />
      <Field label="Sync window start" name="sync_window_start" type="time" defaultValue={initial?.sync_window_start ?? "02:00"} />
      <Field label="Sync window end" name="sync_window_end" type="time" defaultValue={initial?.sync_window_end ?? "05:00"} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

function Field({
  label, name, defaultValue, type = "text",
}: { label: string; name: string; defaultValue?: string; type?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} type={type} required />
    </div>
  );
}
```

- [ ] **Step 3: Stores list + new + edit pages**

Create `dashboard/app/app/stores/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function StoresPage() {
  const supabase = await createClient();
  const { data: stores } = await supabase
    .from("stores")
    .select("id, name, timezone, sync_window_start, sync_window_end")
    .order("name");

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h1 className="text-2xl font-semibold">Stores</h1>
        <Button asChild><Link href="/app/stores/new">New store</Link></Button>
      </div>
      <ul className="space-y-2">
        {(stores ?? []).map((s) => (
          <li key={s.id} className="border rounded p-3">
            <Link href={`/app/stores/${s.id}`} className="flex justify-between">
              <span className="font-medium">{s.name}</span>
              <span className="text-sm text-muted-foreground">
                {s.timezone} · sync {s.sync_window_start}–{s.sync_window_end}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `dashboard/app/app/stores/new/page.tsx`:

```tsx
import { StoreForm } from "@/components/store-form";
import { createStore } from "@/lib/actions/stores";

export default function NewStorePage() {
  async function submit(input: Parameters<typeof createStore>[0]) {
    "use server";
    return await createStore(input);
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New store</h1>
      <StoreForm onSubmit={submit} submitLabel="Create store" />
    </div>
  );
}
```

Create `dashboard/app/app/stores/[id]/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { StoreForm } from "@/components/store-form";
import { updateStore, deleteStore } from "@/lib/actions/stores";
import { Button } from "@/components/ui/button";

export default async function EditStorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: store } = await supabase
    .from("stores")
    .select("id, name, timezone, sync_window_start, sync_window_end")
    .eq("id", id)
    .maybeSingle();
  if (!store) notFound();

  async function save(input: Parameters<typeof updateStore>[1]) {
    "use server";
    return await updateStore(id, input);
  }

  async function remove() {
    "use server";
    await deleteStore(id);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit store</h1>
      <StoreForm
        initial={{
          name: store.name,
          timezone: store.timezone,
          sync_window_start: store.sync_window_start,
          sync_window_end: store.sync_window_end,
        }}
        onSubmit={save}
        submitLabel="Save"
      />
      <form action={remove}>
        <Button type="submit" variant="destructive">Delete store</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Smoke-test**

`pnpm dev` → create a store ("Jakarta Central", Asia/Jakarta, 02:00, 05:00) → see it in the list → edit it → save → delete it.

- [ ] **Step 5: Commit**

```bash
git add dashboard/
git commit -m "feat(dash): stores CRUD (list, create, edit, delete)"
```

---

## Task 9: Pair a device (call pairing-claim Edge Function from dashboard)

**Files:**
- Create: `dashboard/app/app/devices/pair/page.tsx`
- Create: `dashboard/components/pair-device-form.tsx`
- Create: `dashboard/lib/actions/devices.ts`

- [ ] **Step 1: Server action wrapping pairing-claim**

Create `dashboard/lib/actions/devices.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type ClaimInput = { code: string; store_id: string; name?: string };

export async function claimPairingCode(input: ClaimInput) {
  if (!/^[A-Z0-9]{6}$/.test(input.code)) return { error: "Code must be 6 letters/digits." };
  if (!input.store_id) return { error: "Pick a store." };

  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/pairing-claim`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      code: input.code.toUpperCase(),
      store_id: input.store_id,
      name: input.name?.trim() || "TV",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `Pairing failed: ${res.status} ${text}` };
  }
  revalidatePath("/app/devices");
  redirect("/app/devices");
}

export async function renameDevice(id: string, name: string) {
  if (!name.trim()) return { error: "Name required." };
  const supabase = await createClient();
  const { error } = await supabase.from("devices").update({ name: name.trim() }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/devices");
  revalidatePath(`/app/devices/${id}`);
}

export async function deleteDevice(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("devices").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/devices");
  redirect("/app/devices");
}
```

- [ ] **Step 2: Pair form component**

Create `dashboard/components/pair-device-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Store = { id: string; name: string };
type Props = {
  stores: Store[];
  onSubmit: (input: { code: string; store_id: string; name?: string }) => Promise<{ error?: string } | void>;
};

export function PairDeviceForm({ stores, onSubmit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input = {
          code: String(fd.get("code") ?? "").toUpperCase(),
          store_id: String(fd.get("store_id") ?? ""),
          name: String(fd.get("name") ?? ""),
        };
        start(async () => {
          const r = await onSubmit(input);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="code">Pairing code (from TV screen)</Label>
        <Input id="code" name="code" placeholder="ABC123" maxLength={6} required pattern="[A-Za-z0-9]{6}" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="store_id">Store</Label>
        <select id="store_id" name="store_id" className="border rounded h-10 w-full px-3" required>
          <option value="">Select a store…</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Device name</Label>
        <Input id="name" name="name" placeholder="TV - Front counter" />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Pairing…" : "Pair TV"}</Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Pair page**

Create `dashboard/app/app/devices/pair/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { PairDeviceForm } from "@/components/pair-device-form";
import { claimPairingCode } from "@/lib/actions/devices";
import Link from "next/link";

export default async function PairPage() {
  const supabase = await createClient();
  const { data: stores } = await supabase.from("stores").select("id, name").order("name");

  async function submit(input: { code: string; store_id: string; name?: string }) {
    "use server";
    return await claimPairingCode(input);
  }

  if (!stores || stores.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Pair a TV</h1>
        <p>You need to <Link href="/app/stores/new" className="underline">create a store</Link> first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Pair a TV</h1>
      <p className="text-muted-foreground">Enter the 6-character code shown on the TV screen.</p>
      <PairDeviceForm stores={stores} onSubmit={submit} />
    </div>
  );
}
```

- [ ] **Step 4: Smoke-test**

`pnpm dev`. On local Supabase, first generate a pairing code via `curl`:

```bash
curl -sS -X POST http://127.0.0.1:54321/functions/v1/pairing-request -H "content-type: application/json" -d '{}'
```
Copy the 6-char code from the response. In the dashboard: Pair → enter code, select store, name → submit. Should land on `/app/devices` (empty list until we build it in the next task — that's fine).

Check the DB via `psql` (or Supabase Studio at `http://127.0.0.1:54323`):
```sql
select id, name, store_id from devices;
```
Should show the new device row.

- [ ] **Step 5: Commit**

```bash
git add dashboard/
git commit -m "feat(dash): pair-TV flow via pairing-claim Edge Function"
```

---

## Task 10: Devices list + detail page (read-only)

**Files:**
- Modify: `dashboard/app/app/devices/page.tsx` (create — list)
- Create: `dashboard/app/app/devices/[id]/page.tsx`
- Create: `dashboard/components/device-status-badge.tsx`
- Create: `dashboard/components/rename-device-form.tsx`

- [ ] **Step 1: Status badge**

Create `dashboard/components/device-status-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

export function DeviceStatusBadge({ last_seen_at }: { last_seen_at: string | null }) {
  if (!last_seen_at) return <Badge variant="secondary">Never paired</Badge>;
  const ageSec = (Date.now() - new Date(last_seen_at).getTime()) / 1000;
  if (ageSec < 120) return <Badge className="bg-green-600">Online</Badge>;
  if (ageSec < 600) return <Badge className="bg-amber-500">Slow</Badge>;
  return <Badge variant="destructive">Offline</Badge>;
}
```

- [ ] **Step 2: Devices list**

Create `dashboard/app/app/devices/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DeviceStatusBadge } from "@/components/device-status-badge";

export default async function DevicesPage() {
  const supabase = await createClient();
  const { data: devices } = await supabase
    .from("devices")
    .select("id, name, last_seen_at, store_id, stores(name)")
    .order("name");

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h1 className="text-2xl font-semibold">Devices</h1>
        <Button asChild><Link href="/app/devices/pair">Pair a TV</Link></Button>
      </div>
      <ul className="space-y-2">
        {(devices ?? []).map((d) => (
          <li key={d.id} className="border rounded p-3">
            <Link href={`/app/devices/${d.id}`} className="flex justify-between items-center">
              <span>
                <span className="font-medium">{d.name}</span>
                {" · "}
                <span className="text-muted-foreground text-sm">
                  {(d.stores as { name: string } | null)?.name}
                </span>
              </span>
              <DeviceStatusBadge last_seen_at={d.last_seen_at} />
            </Link>
          </li>
        ))}
        {(!devices || devices.length === 0) && (
          <li className="text-muted-foreground">
            No devices. <Link href="/app/devices/pair" className="underline">Pair a TV</Link> to start.
          </li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Rename form component**

Create `dashboard/components/rename-device-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  initialName: string;
  onSubmit: (name: string) => Promise<{ error?: string } | void>;
};

export function RenameDeviceForm({ initialName, onSubmit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-2 max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const name = String(new FormData(e.currentTarget).get("name") ?? "");
        start(async () => {
          const r = await onSubmit(name);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
    >
      <Label htmlFor="name">Device name</Label>
      <div className="flex gap-2">
        <Input id="name" name="name" defaultValue={initialName} required />
        <Button type="submit" disabled={pending}>{pending ? "…" : "Save"}</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Device detail page (read-only heartbeat + rename + delete)**

Create `dashboard/app/app/devices/[id]/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { DeviceStatusBadge } from "@/components/device-status-badge";
import { RenameDeviceForm } from "@/components/rename-device-form";
import { renameDevice, deleteDevice } from "@/lib/actions/devices";
import { Button } from "@/components/ui/button";

export default async function DeviceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: device } = await supabase
    .from("devices")
    .select(`
      id, name, store_id, last_seen_at, fcm_token, fallback_playlist_id,
      cache_storage_info, stores(name, timezone)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!device) notFound();

  async function rename(name: string) {
    "use server";
    return await renameDevice(id, name);
  }
  async function remove() {
    "use server";
    await deleteDevice(id);
  }

  const cache = device.cache_storage_info as {
    root?: string; total_bytes?: number; free_bytes?: number; filesystem?: string;
  } | null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold">{device.name}</h1>
          <p className="text-muted-foreground text-sm">
            {(device.stores as { name: string } | null)?.name}
          </p>
        </div>
        <DeviceStatusBadge last_seen_at={device.last_seen_at} />
      </div>

      <section className="border rounded p-4 space-y-2 text-sm">
        <div><span className="text-muted-foreground">Last seen: </span>{device.last_seen_at ?? "never"}</div>
        {cache && (
          <div>
            <span className="text-muted-foreground">Cache storage: </span>
            {cache.root ?? "?"} ({cache.filesystem ?? "?"}) —
            {" "}{Math.round((cache.free_bytes ?? 0) / 1e9)} GB free
            {" / "}{Math.round((cache.total_bytes ?? 0) / 1e9)} GB total
          </div>
        )}
        {/* Extended heartbeat fields (app version, current playlist, config version, clock skew)
            are surfaced in Task 21 once the schema migration adds the columns. */}
      </section>

      <RenameDeviceForm initialName={device.name} onSubmit={rename} />

      <form action={remove}>
        <Button type="submit" variant="destructive">Delete device</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Smoke-test**

Pair a device, visit `/app/devices`, click into detail, rename, save. Delete. Confirm removed from list.

- [ ] **Step 6: Commit**

```bash
git add dashboard/
git commit -m "feat(dash): devices list + detail with heartbeat display and rename/delete"
```

---

## Task 11: Sync Now button on device detail

**Files:**
- Modify: `dashboard/app/app/devices/[id]/page.tsx`
- Create: `dashboard/components/sync-now-button.tsx`
- Modify: `dashboard/lib/actions/devices.ts` (add `syncNow` action)

- [ ] **Step 1: Add `syncNow` server action**

Append to `dashboard/lib/actions/devices.ts`:

```ts
export async function syncNow(deviceId: string) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/devices-sync-now`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (res.status !== 202) {
    const text = await res.text();
    return { error: `Sync failed: ${res.status} ${text}` };
  }
  return { ok: true };
}
```

- [ ] **Step 2: Sync Now button component**

Create `dashboard/components/sync-now-button.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type Props = { onClick: () => Promise<{ ok?: boolean; error?: string }> };

export function SyncNowButton({ onClick }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          setMsg(null);
          start(async () => {
            const r = await onClick();
            setMsg(r.error ? `Error: ${r.error}` : "Sync signal sent.");
          });
        }}
      >
        {pending ? "Sending…" : "Sync Now"}
      </Button>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Wire the button into device detail**

In `dashboard/app/app/devices/[id]/page.tsx`, add inside the component (after the cache/heartbeat section, before Rename):

```tsx
import { SyncNowButton } from "@/components/sync-now-button";
import { syncNow } from "@/lib/actions/devices";

// ... inside the component, after the heartbeat section, before rename form:

<SyncNowButton onClick={async () => {
  "use server";
  return await syncNow(id);
}} />
```

- [ ] **Step 4: Smoke-test**

On device detail page, click "Sync Now". Expect message "Sync signal sent." (FCM send will be no-op because paired test device has no `fcm_token`; 202 is the expected response.)

- [ ] **Step 5: Commit**

```bash
git add dashboard/
git commit -m "feat(dash): Sync Now button on device detail"
```

---

## Task 12: Media — schema extension + upload Edge Function

**Why this task does two things:** the existing `media` schema (Plan 1) was designed for already-uploaded rows: `checksum` is `NOT NULL`, there's no `mime_type`, no upload-lifecycle state, `kind` is a derived enum. Two-phase upload (insert pending row → client PUTs to R2 → client marks uploaded with checksum) needs all three of those relaxed/added. Migration lands first, then the Edge Function can use the new shape.

**Files:**
- Create: `supabase/migrations/20260422000050_media_pending_support.sql`
- Create: `supabase/functions/media-upload-url/index.ts`
- Create: `supabase/functions/media-upload-url/deno.json`
- Modify: `supabase/config.toml` (add `[functions.media-upload-url]`)
- Create: `supabase/functions/tests/media_upload_url.test.ts`

- [ ] **Step 1: Schema migration to support two-phase uploads**

Create `supabase/migrations/20260422000050_media_pending_support.sql`:

```sql
-- Extend media to support two-phase uploads (pending → uploaded).
-- Also add mime_type so presigned PUT URLs can include Content-Type.

alter table public.media
  add column if not exists mime_type text,
  add column if not exists upload_state text not null default 'uploaded'
    check (upload_state in ('pending','uploaded','failed'));

-- Relax NOT NULL on checksum for pending rows.
alter table public.media alter column checksum drop not null;

-- Drop the original CHECK that required video_duration_seconds NOT NULL for videos,
-- and replace with one that only enforces it once upload_state = 'uploaded'.
-- The existing constraint name is derived from the column list; drop defensively.
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.media'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%video_duration_seconds%'
  loop
    execute format('alter table public.media drop constraint %I', c);
  end loop;
end$$;

alter table public.media add constraint media_kind_duration_check check (
  upload_state <> 'uploaded'
  or (
    (kind = 'image' and video_duration_seconds is null)
    or (kind = 'video' and video_duration_seconds is not null and video_duration_seconds > 0)
  )
);
```

Apply: `supabase db reset` → expect no errors (prior migrations still apply, new CHECK valid on empty table).

- [ ] **Step 2: Write the failing integration test**

Create `supabase/functions/tests/media_upload_url.test.ts`:

```ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

Deno.test({
  name: "media-upload-url returns presigned PUT URL and creates pending media row",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/media-upload-url`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${creds.user_jwt}`,
      },
      body: JSON.stringify({
        filename: "test-video.mp4",
        mime_type: "video/mp4",
        size_bytes: 1024 * 1024,
      }),
    });
    assertEquals(r.status, 200);
    const body = await r.json() as {
      media_id?: string; upload_url?: string; expires_at?: string;
    };
    assert(body.media_id, "media_id missing");
    assert(body.upload_url?.startsWith("https://"), "upload_url not https");
    assert(body.expires_at, "expires_at missing");
  },
});

Deno.test({
  name: "media-upload-url 401 without auth",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const r = await fetch(`${FN}/media-upload-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "x.mp4", mime_type: "video/mp4", size_bytes: 1 }),
    });
    assertEquals(r.status, 401);
    await r.body?.cancel();
  },
});
```

- [ ] **Step 3: Run test — see it fail**

```bash
deno task test
```
Expected failure: `media-upload-url` not deployed (404 from edge runtime).

- [ ] **Step 4: Scaffold + implement function**

```bash
supabase functions new media-upload-url
```

Replace `supabase/functions/media-upload-url/index.ts`:

```ts
// supabase/functions/media-upload-url/index.ts
// Dashboard-facing: authenticated tenant user requests an R2 presigned PUT URL
// to upload a new media file. Server inserts a "pending" media row first so
// the upload has a stable media_id to reference. Client PUTs to R2, then calls
// a separate server action to finalize the row (upload_state='uploaded',
// checksum, and — for videos — video_duration_seconds).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { presignR2PutUrl } from "../_shared/r2.ts";

function kindFromMime(mime: string): "video" | "image" | null {
  if (mime === "video/mp4") return "video";
  if (mime === "image/jpeg" || mime === "image/png") return "image";
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl) throw new Error("SUPABASE_URL must be set");
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY must be set");

  const userJwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!userJwt) return new Response("unauthenticated", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const filename = typeof body.filename === "string" ? body.filename : "";
  const mime = typeof body.mime_type === "string" ? body.mime_type : "";
  const size = typeof body.size_bytes === "number" ? body.size_bytes : 0;
  if (!filename || !mime || size <= 0) {
    return new Response("missing filename, mime_type, or size_bytes", { status: 400 });
  }
  if (size > 500 * 1024 * 1024) {
    return new Response("file too large (max 500 MB)", { status: 413 });
  }
  const kind = kindFromMime(mime);
  if (!kind) return new Response("unsupported mime type", { status: 415 });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false },
  });

  // Resolve caller's tenant (RLS-scoped).
  const { data: tm, error: tmErr } = await userClient
    .from("tenant_members")
    .select("tenant_id")
    .maybeSingle();
  if (tmErr) return new Response("db: " + tmErr.message, { status: 500 });
  if (!tm) return new Response("no tenant", { status: 403 });

  const ext = filename.includes(".") ? filename.split(".").pop() : "";
  const mediaId = crypto.randomUUID();
  const r2Path = `tenants/${tm.tenant_id}/media/${mediaId}${ext ? "." + ext : ""}`;

  const { data: inserted, error: insErr } = await userClient
    .from("media")
    .insert({
      id: mediaId,
      tenant_id: tm.tenant_id,
      kind,
      mime_type: mime,
      original_filename: filename,
      size_bytes: size,
      r2_path: r2Path,
      upload_state: "pending",
      // checksum + video_duration_seconds populated later by finalize action
    })
    .select("id")
    .single();
  if (insErr) return new Response("db: " + insErr.message, { status: 500 });
  if (!inserted) return new Response("insert returned no row", { status: 500 });

  const upload_url = await presignR2PutUrl(r2Path, mime);
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  return Response.json({ media_id: inserted.id, upload_url, expires_at });
});
```

Create `supabase/functions/media-upload-url/deno.json`:

```json
{
  "imports": {}
}
```

Add to `supabase/config.toml` (append):

```toml
[functions.media-upload-url]
enabled = true
verify_jwt = false
import_map = "./functions/media-upload-url/deno.json"
entrypoint = "./functions/media-upload-url/index.ts"
```

- [ ] **Step 5: Restart edge runtime + run tests**

```bash
docker restart supabase_edge_runtime_smart-tv-video-viewer
sleep 3
deno task test
```
Expected: all prior tests still pass + 2 new tests pass (total 25).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260422000050_media_pending_support.sql \
  supabase/functions/media-upload-url supabase/config.toml \
  supabase/functions/tests/media_upload_url.test.ts
git commit -m "feat(fn): media-upload-url + schema support for two-phase pending uploads"
```

---

## Task 13: Media — finalize action + uploader component + library list

**Files:**
- Create: `dashboard/lib/actions/media.ts`
- Create: `dashboard/components/media-uploader.tsx`
- Create: `dashboard/app/app/media/page.tsx`

- [ ] **Step 1: Media server actions**

Create `dashboard/lib/actions/media.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function requestUploadUrl(input: {
  filename: string; mime_type: string; size_bytes: number;
}) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/media-upload-url`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const t = await res.text();
    return { error: `upload-url: ${res.status} ${t}` };
  }
  return await res.json() as { media_id: string; upload_url: string; expires_at: string };
}

export async function finalizeMedia(input: {
  media_id: string; checksum_sha256: string; duration_seconds?: number;
}) {
  const supabase = await createClient();
  const update: Record<string, unknown> = {
    upload_state: "uploaded",
    checksum: input.checksum_sha256,
  };
  if (typeof input.duration_seconds === "number") {
    update.video_duration_seconds = input.duration_seconds;
  }
  const { error } = await supabase.from("media").update(update).eq("id", input.media_id);
  if (error) return { error: error.message };
  revalidatePath("/app/media");
  return { ok: true };
}

export async function deleteMedia(id: string) {
  const supabase = await createClient();
  // NOTE: this deletes the DB row; the R2 object becomes orphaned. A periodic
  // cleanup job (v1.1+) can sweep orphans. Acceptable at 8-device scale for v1.
  const { error } = await supabase.from("media").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/media");
}
```

- [ ] **Step 2: Uploader component with browser-side checksum + PUT to R2**

Create `dashboard/components/media-uploader.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { requestUploadUrl, finalizeMedia } from "@/lib/actions/media";

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function videoDurationSeconds(file: File): Promise<number | undefined> {
  if (!file.type.startsWith("video/")) return undefined;
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error("video metadata failed"));
    });
    return Math.round(v.duration);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function MediaUploader() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  async function handleUpload(file: File) {
    setStatus("Preparing upload…");
    setProgress(0);

    const r = await requestUploadUrl({
      filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    });
    if ("error" in r) { setStatus(`Error: ${r.error}`); return; }

    setStatus("Uploading to R2…");
    const put = await fetch(r.upload_url, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type },
    });
    if (!put.ok) {
      setStatus(`Upload failed: ${put.status}`);
      return;
    }

    setStatus("Computing checksum…");
    const checksum = await sha256Hex(file);
    const duration = await videoDurationSeconds(file);

    setStatus("Finalizing…");
    const fin = await finalizeMedia({
      media_id: r.media_id,
      checksum_sha256: checksum,
      duration_seconds: duration,
    });
    if (fin && "error" in fin && fin.error) {
      setStatus(`Finalize failed: ${fin.error}`);
      return;
    }
    setStatus("Done.");
    setProgress(100);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="border rounded p-4 space-y-3">
      <h2 className="font-medium">Upload media</h2>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,image/jpeg,image/png"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
        }}
      />
      {status && <p className="text-sm text-muted-foreground">{status}</p>}
      {progress > 0 && progress < 100 && <progress value={progress} max={100} className="w-full" />}
    </div>
  );
}
```

- [ ] **Step 3: Media library page**

Create `dashboard/app/app/media/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { MediaUploader } from "@/components/media-uploader";
import { deleteMedia } from "@/lib/actions/media";
import { Button } from "@/components/ui/button";

export default async function MediaPage() {
  const supabase = await createClient();
  const { data: media } = await supabase
    .from("media")
    .select("id, original_filename, mime_type, kind, size_bytes, video_duration_seconds, upload_state, uploaded_at")
    .order("uploaded_at", { ascending: false });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Media library</h1>
      <MediaUploader />
      <ul className="space-y-2">
        {(media ?? []).map((m) => {
          async function remove() {
            "use server";
            await deleteMedia(m.id);
          }
          return (
            <li key={m.id} className="border rounded p-3 flex justify-between items-center">
              <div className="flex-1">
                <div className="font-medium">{m.original_filename}</div>
                <div className="text-sm text-muted-foreground">
                  {m.mime_type ?? m.kind} · {Math.round(m.size_bytes / 1024)} KB
                  {m.video_duration_seconds ? ` · ${m.video_duration_seconds}s` : ""}
                  {" · "}<span className={m.upload_state === "uploaded" ? "" : "text-amber-600"}>{m.upload_state}</span>
                </div>
              </div>
              <form action={remove}>
                <Button type="submit" variant="ghost" size="sm">Delete</Button>
              </form>
            </li>
          );
        })}
        {(!media || media.length === 0) && (
          <li className="text-muted-foreground text-sm">No media uploaded yet.</li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Smoke-test**

`pnpm dev`. Upload a small .mp4 or .jpg. Check:
1. Progress goes through "Preparing" → "Uploading" → "Computing checksum" → "Finalizing" → "Done."
2. File appears in the list with status "uploaded".
3. Check R2 via Cloudflare dashboard — object exists at `tenants/<uuid>/media/<uuid>.<ext>`.
4. Delete from UI → removed from list.

- [ ] **Step 5: Commit**

```bash
git add dashboard/
git commit -m "feat(dash): media library with R2 two-phase upload and checksum"
```

---

## Task 14: Playlists — list + composer with drag-reorder

**Files:**
- Create: `dashboard/lib/actions/playlists.ts`
- Create: `dashboard/app/app/playlists/page.tsx`
- Create: `dashboard/app/app/playlists/[id]/page.tsx`
- Create: `dashboard/components/playlist-composer.tsx`
- Create: `dashboard/components/sortable-items.tsx`

- [ ] **Step 1: Install drag-and-drop deps**

```bash
cd dashboard
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
cd ..
```

- [ ] **Step 2: Playlist server actions**

Create `dashboard/lib/actions/playlists.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createPlaylist(name: string) {
  if (!name.trim()) return { error: "Name required." };
  const supabase = await createClient();
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return { error: "No tenant context." };
  const { data, error } = await supabase.from("playlists")
    .insert({ tenant_id: tm.tenant_id, name: name.trim() })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/app/playlists");
  redirect(`/app/playlists/${data.id}`);
}

export async function renamePlaylist(id: string, name: string) {
  if (!name.trim()) return { error: "Name required." };
  const supabase = await createClient();
  const { error } = await supabase.from("playlists").update({ name: name.trim() }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/playlists");
  revalidatePath(`/app/playlists/${id}`);
}

export async function deletePlaylist(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("playlists").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/playlists");
  redirect("/app/playlists");
}

export async function addPlaylistItem(
  playlistId: string, mediaId: string, durationSeconds?: number,
) {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("playlist_items")
    .select("position")
    .eq("playlist_id", playlistId)
    .order("position", { ascending: false })
    .limit(1);
  const nextOrder = (existing?.[0]?.position ?? -1) + 1;
  const { error } = await supabase.from("playlist_items").insert({
    playlist_id: playlistId,
    media_id: mediaId,
    position: nextOrder,
    duration_seconds: durationSeconds ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/app/playlists/${playlistId}`);
}

export async function removePlaylistItem(playlistId: string, itemId: string) {
  const supabase = await createClient();
  // After delete, compact positions so there are no holes (keeps the UNIQUE
  // (playlist_id, position) constraint tidy and keeps 0..n-1 contiguous).
  const { error: delErr } = await supabase.from("playlist_items").delete().eq("id", itemId);
  if (delErr) return { error: delErr.message };

  const { data: remaining, error: selErr } = await supabase
    .from("playlist_items")
    .select("id")
    .eq("playlist_id", playlistId)
    .order("position", { ascending: true });
  if (selErr) return { error: selErr.message };
  if (remaining && remaining.length > 0) {
    const ids = remaining.map(r => r.id);
    const res = await reorderPlaylistItems(playlistId, ids);
    if (res && "error" in res && res.error) return { error: res.error };
  }
  revalidatePath(`/app/playlists/${playlistId}`);
}

// Two-phase reorder avoids violating UNIQUE (playlist_id, position):
// phase 1 bumps everyone into a "scratch range" (10000+i); phase 2 assigns
// final 0..n-1. Without this, sequential updates collide whenever a later
// item is moved earlier.
export async function reorderPlaylistItems(playlistId: string, orderedItemIds: string[]) {
  const supabase = await createClient();
  for (let i = 0; i < orderedItemIds.length; i++) {
    const { error } = await supabase.from("playlist_items")
      .update({ position: 10000 + i })
      .eq("id", orderedItemIds[i]);
    if (error) return { error: error.message };
  }
  for (let i = 0; i < orderedItemIds.length; i++) {
    const { error } = await supabase.from("playlist_items")
      .update({ position: i })
      .eq("id", orderedItemIds[i]);
    if (error) return { error: error.message };
  }
  revalidatePath(`/app/playlists/${playlistId}`);
}

export async function updateItemDuration(itemId: string, durationSeconds: number | null, playlistId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("playlist_items")
    .update({ duration_seconds: durationSeconds })
    .eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath(`/app/playlists/${playlistId}`);
}
```

- [ ] **Step 3: Sortable list component**

Create `dashboard/components/sortable-items.tsx`:

```tsx
"use client";

import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";

type Item = { id: string; content: React.ReactNode };

export function SortableItems({
  items, onReorder,
}: { items: Item[]; onReorder: (ids: string[]) => void }) {
  const [order, setOrder] = useState(items.map(i => i.id));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = order.indexOf(String(active.id));
    const newIdx = order.indexOf(String(over.id));
    const next = arrayMove(order, oldIdx, newIdx);
    setOrder(next);
    onReorder(next);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {order.map(id => {
            const item = items.find(i => i.id === id);
            if (!item) return null;
            return <SortableRow key={id} id={id}>{item.content}</SortableRow>;
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <li ref={setNodeRef} style={style} {...attributes} {...listeners}
        className="border rounded p-3 cursor-grab bg-background">
      {children}
    </li>
  );
}
```

- [ ] **Step 4: Playlist composer client component**

Create `dashboard/components/playlist-composer.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SortableItems } from "@/components/sortable-items";
import {
  addPlaylistItem, removePlaylistItem, reorderPlaylistItems,
  updateItemDuration,
} from "@/lib/actions/playlists";

type Media = { id: string; original_filename: string; mime_type: string | null; video_duration_seconds: number | null };
type Item = { id: string; media_id: string; position: number; duration_seconds: number | null; media: Media | null };

type Props = {
  playlistId: string;
  items: Item[];
  media: Media[];
};

export function PlaylistComposer({ playlistId, items, media }: Props) {
  const [pending, start] = useTransition();

  function handleAdd(mediaId: string) {
    const m = media.find(x => x.id === mediaId);
    start(() => addPlaylistItem(playlistId, mediaId, m?.video_duration_seconds ?? undefined));
  }

  function handleRemove(itemId: string) {
    start(() => removePlaylistItem(playlistId, itemId));
  }

  function handleReorder(ids: string[]) {
    start(() => reorderPlaylistItems(playlistId, ids));
  }

  function handleDuration(itemId: string, value: string) {
    const n = parseInt(value, 10);
    start(() => updateItemDuration(itemId, Number.isFinite(n) && n > 0 ? n : null, playlistId));
  }

  const orderedItems = [...items].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-medium mb-2">Items (drag to reorder)</h2>
        {orderedItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">Playlist is empty. Add media below.</p>
        ) : (
          <SortableItems
            items={orderedItems.map(i => ({
              id: i.id,
              content: (
                <div className="flex items-center justify-between gap-3">
                  <span className="flex-1 truncate">{i.media?.original_filename ?? "(deleted media)"}</span>
                  <Input
                    type="number"
                    min={1}
                    className="w-24"
                    defaultValue={i.duration_seconds ?? ""}
                    placeholder="sec"
                    onBlur={(e) => handleDuration(i.id, e.target.value)}
                  />
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleRemove(i.id)}>
                    Remove
                  </Button>
                </div>
              ),
            }))}
            onReorder={handleReorder}
          />
        )}
      </section>

      <section>
        <h2 className="font-medium mb-2">Add media</h2>
        <ul className="space-y-2">
          {media.filter(m => !orderedItems.some(oi => oi.media_id === m.id)).map(m => (
            <li key={m.id} className="border rounded p-3 flex justify-between">
              <span>{m.original_filename}</span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => handleAdd(m.id)}>
                Add to playlist
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Playlists list + detail pages**

Create `dashboard/app/app/playlists/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createPlaylist } from "@/lib/actions/playlists";
import { Input } from "@/components/ui/input";

export default async function PlaylistsPage() {
  const supabase = await createClient();
  const { data: playlists } = await supabase
    .from("playlists").select("id, name").order("name");

  async function create(fd: FormData) {
    "use server";
    return await createPlaylist(String(fd.get("name") ?? ""));
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Playlists</h1>

      <form action={create} className="flex gap-2 max-w-md">
        <Input name="name" placeholder="New playlist name" required />
        <Button type="submit">Create</Button>
      </form>

      <ul className="space-y-2">
        {(playlists ?? []).map(p => (
          <li key={p.id} className="border rounded p-3">
            <Link href={`/app/playlists/${p.id}`} className="font-medium">{p.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `dashboard/app/app/playlists/[id]/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PlaylistComposer } from "@/components/playlist-composer";
import { deletePlaylist, renamePlaylist } from "@/lib/actions/playlists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function PlaylistDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: playlist }, { data: items }, { data: media }] = await Promise.all([
    supabase.from("playlists").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("playlist_items")
      .select("id, media_id, position, duration_seconds, media(id, original_filename, mime_type, video_duration_seconds)")
      .eq("playlist_id", id),
    supabase.from("media")
      .select("id, original_filename, mime_type, video_duration_seconds")
      .eq("upload_state", "uploaded")
      .order("uploaded_at", { ascending: false }),
  ]);
  if (!playlist) notFound();

  async function rename(fd: FormData) {
    "use server";
    await renamePlaylist(id, String(fd.get("name") ?? ""));
  }
  async function remove() {
    "use server";
    await deletePlaylist(id);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <form action={rename} className="flex gap-2">
        <Input name="name" defaultValue={playlist.name} required />
        <Button type="submit">Rename</Button>
      </form>

      <PlaylistComposer
        playlistId={id}
        items={(items ?? []).map(i => ({
          id: i.id, media_id: i.media_id, position: i.position,
          duration_seconds: i.duration_seconds,
          media: i.media as { id: string; original_filename: string; mime_type: string | null; video_duration_seconds: number | null } | null,
        }))}
        media={media ?? []}
      />

      <form action={remove}>
        <Button type="submit" variant="destructive">Delete playlist</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Smoke-test**

Create a playlist, add items, drag-reorder, set durations, save, delete. Verify DB via Studio:
```sql
select * from playlist_items order by position;
```
Order indexes should reflect the current UI order.

- [ ] **Step 7: Commit**

```bash
git add dashboard/
git commit -m "feat(dash): playlists list + composer with drag-reorder"
```

---

## Task 15: Device-level playlist assignment

**Files:**
- Modify: `dashboard/app/app/devices/[id]/page.tsx`
- Create: `dashboard/components/assign-playlist-form.tsx`
- Modify: `dashboard/lib/actions/devices.ts` (add `assignFallbackPlaylist`)

- [ ] **Step 1: Add server action**

Append to `dashboard/lib/actions/devices.ts`:

```ts
export async function assignFallbackPlaylist(deviceId: string, playlistId: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("devices")
    .update({ fallback_playlist_id: playlistId })
    .eq("id", deviceId);
  if (error) return { error: error.message };
  revalidatePath(`/app/devices/${deviceId}`);
  revalidatePath("/app/devices");
  revalidatePath("/app");
}
```

- [ ] **Step 2: Assignment form component**

Create `dashboard/components/assign-playlist-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Playlist = { id: string; name: string };
type Props = {
  current: string | null;
  playlists: Playlist[];
  onSubmit: (id: string | null) => Promise<{ error?: string } | void>;
};

export function AssignPlaylistForm({ current, playlists, onSubmit }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-2 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const raw = String(new FormData(e.currentTarget).get("playlist_id") ?? "");
        const playlistId = raw === "" ? null : raw;
        start(async () => {
          const r = await onSubmit(playlistId);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
    >
      <Label htmlFor="playlist_id">Fallback playlist (plays 24/7 unless a dayparting rule overrides)</Label>
      <div className="flex gap-2">
        <select name="playlist_id" defaultValue={current ?? ""} className="border rounded h-10 flex-1 px-3">
          <option value="">— none —</option>
          {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Button type="submit" disabled={pending}>{pending ? "…" : "Save"}</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Wire into device detail**

In `dashboard/app/app/devices/[id]/page.tsx`, add:

```tsx
// Top imports:
import { AssignPlaylistForm } from "@/components/assign-playlist-form";
import { assignFallbackPlaylist } from "@/lib/actions/devices";

// Inside the component, fetch playlists:
const { data: playlists } = await supabase.from("playlists").select("id, name").order("name");

// Add this server action:
async function assign(playlistId: string | null) {
  "use server";
  return await assignFallbackPlaylist(id, playlistId);
}

// Render above the Rename form:
<section className="border rounded p-4 space-y-2">
  <h2 className="font-medium">Playlist assignment</h2>
  <AssignPlaylistForm current={device.fallback_playlist_id} playlists={playlists ?? []} onSubmit={assign} />
</section>
```

- [ ] **Step 4: Smoke-test**

On device detail, pick a playlist, save, reload — shows the selected playlist. Clear (— none —), save, reload — empty.

- [ ] **Step 5: Commit**

```bash
git add dashboard/
git commit -m "feat(dash): per-device fallback playlist assignment"
```

---

## Task 16: Batch "set all devices in store" assignment

**Files:**
- Modify: `dashboard/app/app/stores/[id]/page.tsx`
- Modify: `dashboard/lib/actions/stores.ts` (add `assignPlaylistToAllDevicesInStore`)

- [ ] **Step 1: Add server action**

Append to `dashboard/lib/actions/stores.ts`:

```ts
export async function assignPlaylistToAllDevicesInStore(
  storeId: string, playlistId: string | null,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("devices")
    .update({ fallback_playlist_id: playlistId })
    .eq("store_id", storeId);
  if (error) return { error: error.message };
  revalidatePath("/app/stores");
  revalidatePath(`/app/stores/${storeId}`);
  revalidatePath("/app/devices");
}
```

- [ ] **Step 2: Add section to store detail page**

In `dashboard/app/app/stores/[id]/page.tsx`, add at the bottom:

```tsx
// Top imports (add):
import { AssignPlaylistForm } from "@/components/assign-playlist-form";
import { assignPlaylistToAllDevicesInStore } from "@/lib/actions/stores";

// Fetch playlists + store devices:
const [{ data: playlists }, { data: devicesInStore }] = await Promise.all([
  supabase.from("playlists").select("id, name").order("name"),
  supabase.from("devices").select("id, fallback_playlist_id").eq("store_id", id),
]);

// Determine common assignment (null if mixed):
const common: string | null = (() => {
  const ids = new Set((devicesInStore ?? []).map(d => d.fallback_playlist_id));
  return ids.size === 1 ? (devicesInStore?.[0]?.fallback_playlist_id ?? null) : null;
})();

async function assignAll(playlistId: string | null) {
  "use server";
  return await assignPlaylistToAllDevicesInStore(id, playlistId);
}

// Render (add below the StoreForm + above delete button):
<section className="border rounded p-4 space-y-2">
  <h2 className="font-medium">Assign playlist to all TVs in this store</h2>
  <p className="text-sm text-muted-foreground">
    {devicesInStore?.length ?? 0} devices. {common === null && (devicesInStore?.length ?? 0) > 0 ? "(currently mixed assignments)" : ""}
  </p>
  <AssignPlaylistForm current={common} playlists={playlists ?? []} onSubmit={assignAll} />
</section>
```

- [ ] **Step 3: Smoke-test**

Create a store, pair 2 devices into it, go to store detail, set batch playlist, save. Visit each device detail — both show the new playlist.

- [ ] **Step 4: Commit**

```bash
git add dashboard/
git commit -m "feat(dash): batch-assign playlist to all devices in a store"
```

---

## Task 17: Device groups — list + members + group assignment

**Files:**
- Create: `dashboard/app/app/device-groups/page.tsx`
- Create: `dashboard/app/app/device-groups/[id]/page.tsx`
- Create: `dashboard/components/group-members-editor.tsx`
- Create: `dashboard/lib/actions/device-groups.ts`

- [ ] **Step 1: Server actions**

Create `dashboard/lib/actions/device-groups.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createGroup(name: string) {
  if (!name.trim()) return { error: "Name required." };
  const supabase = await createClient();
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return { error: "No tenant context." };
  const { data, error } = await supabase.from("device_groups")
    .insert({ tenant_id: tm.tenant_id, name: name.trim() })
    .select("id").single();
  if (error) return { error: error.message };
  revalidatePath("/app/device-groups");
  redirect(`/app/device-groups/${data.id}`);
}

export async function renameGroup(id: string, name: string) {
  if (!name.trim()) return { error: "Name required." };
  const supabase = await createClient();
  const { error } = await supabase.from("device_groups").update({ name: name.trim() }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/device-groups");
  revalidatePath(`/app/device-groups/${id}`);
}

export async function deleteGroup(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("device_groups").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/device-groups");
  redirect("/app/device-groups");
}

export async function setGroupMembers(groupId: string, deviceIds: string[]) {
  const supabase = await createClient();
  // Wipe + insert. At 8-device scale this is simpler than diffing.
  const { error: delErr } = await supabase.from("device_group_members")
    .delete().eq("device_group_id", groupId);
  if (delErr) return { error: delErr.message };
  if (deviceIds.length > 0) {
    const { error: insErr } = await supabase.from("device_group_members")
      .insert(deviceIds.map(did => ({ device_group_id: groupId, device_id: did })));
    if (insErr) return { error: insErr.message };
  }
  revalidatePath(`/app/device-groups/${groupId}`);
  revalidatePath("/app/device-groups");
}
```

- [ ] **Step 2: Group members editor**

Create `dashboard/components/group-members-editor.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type Device = { id: string; name: string; store_name: string };
type Props = {
  allDevices: Device[];
  currentMemberIds: string[];
  onSubmit: (ids: string[]) => Promise<{ error?: string } | void>;
};

export function GroupMembersEditor({ allDevices, currentMemberIds, onSubmit }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentMemberIds));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function save() {
    setMsg(null);
    start(async () => {
      const r = await onSubmit(Array.from(selected));
      setMsg(r && "error" in r && r.error ? `Error: ${r.error}` : "Saved.");
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {allDevices.map(d => (
          <li key={d.id}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(d.id)}
                onChange={() => toggle(d.id)}
              />
              <span>{d.name}</span>
              <span className="text-sm text-muted-foreground">· {d.store_name}</span>
            </label>
          </li>
        ))}
        {allDevices.length === 0 && <li className="text-sm text-muted-foreground">No devices yet.</li>}
      </ul>
      <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save members"}</Button>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Groups list page**

Create `dashboard/app/app/device-groups/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createGroup } from "@/lib/actions/device-groups";

export default async function GroupsPage() {
  const supabase = await createClient();
  const { data: groups } = await supabase
    .from("device_groups")
    .select("id, name, device_group_members(count)")
    .order("name");

  async function create(fd: FormData) {
    "use server";
    return await createGroup(String(fd.get("name") ?? ""));
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Device groups</h1>
      <form action={create} className="flex gap-2 max-w-md">
        <Input name="name" placeholder="e.g. Lunch-time TVs" required />
        <Button type="submit">Create group</Button>
      </form>
      <ul className="space-y-2">
        {(groups ?? []).map(g => (
          <li key={g.id} className="border rounded p-3">
            <Link href={`/app/device-groups/${g.id}`} className="flex justify-between">
              <span className="font-medium">{g.name}</span>
              <span className="text-sm text-muted-foreground">
                {(g.device_group_members as { count: number }[])?.[0]?.count ?? 0} devices
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Group detail page**

Create `dashboard/app/app/device-groups/[id]/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { GroupMembersEditor } from "@/components/group-members-editor";
import { setGroupMembers, renameGroup, deleteGroup } from "@/lib/actions/device-groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function GroupDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: group }, { data: allDevices }, { data: members }] = await Promise.all([
    supabase.from("device_groups").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("devices").select("id, name, stores(name)").order("name"),
    supabase.from("device_group_members").select("device_id").eq("device_group_id", id),
  ]);
  if (!group) notFound();

  async function rename(fd: FormData) {
    "use server";
    await renameGroup(id, String(fd.get("name") ?? ""));
  }
  async function remove() {
    "use server";
    await deleteGroup(id);
  }
  async function save(ids: string[]) {
    "use server";
    return await setGroupMembers(id, ids);
  }

  const memberIds = (members ?? []).map(m => m.device_id);
  const devices = (allDevices ?? []).map(d => ({
    id: d.id,
    name: d.name,
    store_name: (d.stores as { name: string } | null)?.name ?? "",
  }));

  return (
    <div className="space-y-6 max-w-2xl">
      <form action={rename} className="flex gap-2">
        <Input name="name" defaultValue={group.name} required />
        <Button type="submit">Rename</Button>
      </form>

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-medium">Members</h2>
        <GroupMembersEditor allDevices={devices} currentMemberIds={memberIds} onSubmit={save} />
      </section>

      <form action={remove}>
        <Button type="submit" variant="destructive">Delete group</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Smoke-test**

Create a group, toggle members, save, reload — selected checkboxes persist. Delete group.

- [ ] **Step 6: Commit**

```bash
git add dashboard/
git commit -m "feat(dash): device groups list + members editor"
```

---

## Task 18: Dayparting rules — list + form (per-device and per-group)

**Files:**
- Create: `supabase/migrations/20260422000075_dayparting_rule_label.sql`
- Create: `dashboard/app/app/schedules/page.tsx`
- Create: `dashboard/app/app/schedules/new/page.tsx`
- Create: `dashboard/app/app/schedules/[id]/page.tsx`
- Create: `dashboard/components/dayparting-rule-form.tsx`
- Create: `dashboard/lib/actions/dayparting.ts`

- [ ] **Step 1: Migration — add human-readable `label` column**

The Plan 1 `dayparting_rules` schema has no `label`/`name` column; every rule was identified by `(target, days, start_time, end_time)`. For the dashboard UI we want a human name ("Lunch weekdays"). Add it:

Create `supabase/migrations/20260422000075_dayparting_rule_label.sql`:

```sql
alter table public.dayparting_rules
  add column if not exists label text;
```

No constraint: labels are optional in the data model, we'll require them in the UI.

- [ ] **Step 2: Server actions**

Create `dashboard/lib/actions/dayparting.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type RuleInput = {
  name: string;
  target_type: "device" | "device_group";
  target_id: string;
  days_of_week: number[];        // ISO day numbers 1..7 (1=Monday, 7=Sunday) — matches schema CHECK
  start_time: string;            // HH:MM
  end_time: string;              // HH:MM — schema permits end < start (crosses midnight)
  playlist_id: string;
  effective_at: string;          // ISO timestamp
};

function validate(input: RuleInput): string | null {
  if (!input.name.trim()) return "Name required.";
  if (!Array.isArray(input.days_of_week) || input.days_of_week.length === 0) return "Pick at least one day.";
  if (input.days_of_week.some(d => d < 1 || d > 7)) return "Invalid day (must be 1–7).";
  if (!/^\d{2}:\d{2}$/.test(input.start_time)) return "Start must be HH:MM.";
  if (!/^\d{2}:\d{2}$/.test(input.end_time)) return "End must be HH:MM.";
  if (!input.target_id) return "Pick a target.";
  if (!input.playlist_id) return "Pick a playlist.";
  return null;
}

function toRow(tenantId: string, userId: string, input: RuleInput) {
  return {
    tenant_id: tenantId,
    target_device_id: input.target_type === "device" ? input.target_id : null,
    target_device_group_id: input.target_type === "device_group" ? input.target_id : null,
    days_of_week: input.days_of_week,
    start_time: input.start_time,
    end_time: input.end_time,
    playlist_id: input.playlist_id,
    effective_at: input.effective_at,
    created_by: userId,
  };
}

// The `dayparting_rules` schema has no `name` column. We fold the user-entered
// rule name into a local convention: there's nowhere to store it schema-side,
// so either (a) extend the schema with a `label` column, or (b) drop the name
// input. We pick (a) here — the UI benefits enormously from human-readable
// names. The migration lives in the step below.

export async function createRule(input: RuleInput) {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return { error: "No tenant context." };
  const row = { ...toRow(tm.tenant_id, user.id, input), label: input.name.trim() };
  const { error } = await supabase.from("dayparting_rules").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/app/schedules");
  redirect("/app/schedules");
}

export async function updateRule(id: string, input: RuleInput) {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return { error: "No tenant context." };
  const row = { ...toRow(tm.tenant_id, user.id, input), label: input.name.trim() };
  const { error } = await supabase.from("dayparting_rules").update(row).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/schedules");
  revalidatePath(`/app/schedules/${id}`);
  redirect("/app/schedules");
}

export async function deleteRule(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("dayparting_rules").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/schedules");
  redirect("/app/schedules");
}
```

- [ ] **Step 3: Dayparting rule form (multi-day checkbox)**

Create `dashboard/components/dayparting-rule-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ISO day numbering: 1=Monday through 7=Sunday, matches schema CHECK.
const DAYS: { id: number; short: string }[] = [
  { id: 1, short: "Mon" }, { id: 2, short: "Tue" }, { id: 3, short: "Wed" },
  { id: 4, short: "Thu" }, { id: 5, short: "Fri" }, { id: 6, short: "Sat" },
  { id: 7, short: "Sun" },
];

export type RuleFormValue = {
  name: string;
  target_type: "device" | "device_group";
  target_id: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  playlist_id: string;
  effective_at: string;
};

type Props = {
  initial?: Partial<RuleFormValue>;
  devices: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  playlists: { id: string; name: string }[];
  onSubmit: (input: RuleFormValue) => Promise<{ error?: string } | void>;
  submitLabel: string;
};

export function DaypartingRuleForm({ initial, devices, groups, playlists, onSubmit, submitLabel }: Props) {
  const [targetType, setTargetType] = useState<"device" | "device_group">(initial?.target_type ?? "device");
  const [days, setDays] = useState<Set<number>>(new Set(initial?.days_of_week ?? [1, 2, 3, 4, 5]));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggleDay(d: number) {
    const next = new Set(days);
    if (next.has(d)) next.delete(d); else next.add(d);
    setDays(next);
  }

  return (
    <form
      className="space-y-4 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input: RuleFormValue = {
          name: String(fd.get("name") ?? ""),
          target_type: targetType,
          target_id: String(fd.get("target_id") ?? ""),
          days_of_week: Array.from(days).sort((a, b) => a - b),
          start_time: String(fd.get("start_time") ?? ""),
          end_time: String(fd.get("end_time") ?? ""),
          playlist_id: String(fd.get("playlist_id") ?? ""),
          effective_at: String(fd.get("effective_at") ?? new Date().toISOString()),
        };
        start(async () => {
          const r = await onSubmit(input);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="name">Rule name</Label>
        <Input id="name" name="name" defaultValue={initial?.name} placeholder="e.g. Lunch menu weekdays" required />
      </div>

      <div className="space-y-1.5">
        <Label>Target</Label>
        <div className="flex gap-2 items-center">
          <label className="flex gap-1 items-center">
            <input type="radio" name="target_type" value="device"
              checked={targetType === "device"}
              onChange={() => setTargetType("device")} />
            Single device
          </label>
          <label className="flex gap-1 items-center">
            <input type="radio" name="target_type" value="device_group"
              checked={targetType === "device_group"}
              onChange={() => setTargetType("device_group")} />
            Device group
          </label>
        </div>
        <select name="target_id" defaultValue={initial?.target_id ?? ""}
          className="border rounded h-10 w-full px-3" required>
          <option value="">Select a {targetType === "device" ? "device" : "group"}…</option>
          {(targetType === "device" ? devices : groups).map(t =>
            <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>Days of week (device-local)</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(d => (
            <label key={d.id} className={`border rounded px-3 py-1 cursor-pointer ${days.has(d.id) ? "bg-primary text-primary-foreground" : ""}`}>
              <input type="checkbox" className="sr-only" checked={days.has(d.id)} onChange={() => toggleDay(d.id)} />
              {d.short}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="start_time">Start time</Label>
          <Input type="time" name="start_time" defaultValue={initial?.start_time ?? "11:00"} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end_time">End time</Label>
          <Input type="time" name="end_time" defaultValue={initial?.end_time ?? "14:00"} required />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="playlist_id">Playlist</Label>
        <select name="playlist_id" defaultValue={initial?.playlist_id ?? ""} className="border rounded h-10 w-full px-3" required>
          <option value="">Select a playlist…</option>
          {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="effective_at">Effective from</Label>
        <Input type="datetime-local" name="effective_at"
          defaultValue={(initial?.effective_at ?? new Date().toISOString()).slice(0, 16)} required />
        <p className="text-xs text-muted-foreground">Rule takes effect at this timestamp. Use now for immediate.</p>
      </div>

      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Schedules list + new + edit pages**

Create `dashboard/app/app/schedules/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// ISO day labels: index 1..7 (0 unused).
const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDays(ds: number[]): string {
  const sorted = [...ds].sort((a, b) => a - b);
  // If it's Mon-Fri in one block, shorten.
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return "Mon–Fri";
  if (sorted.length === 7) return "Every day";
  return sorted.map(d => DAY_LABELS[d]).join("/");
}

export default async function SchedulesPage() {
  const supabase = await createClient();
  const { data: rules } = await supabase.from("dayparting_rules")
    .select(`
      id, label, days_of_week, start_time, end_time, effective_at,
      playlists(name),
      target_device_id, devices(name),
      target_device_group_id, device_groups(name)
    `)
    .order("effective_at", { ascending: false });

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h1 className="text-2xl font-semibold">Dayparting rules</h1>
        <Button asChild><Link href="/app/schedules/new">New rule</Link></Button>
      </div>
      <ul className="space-y-2">
        {(rules ?? []).map(r => (
          <li key={r.id} className="border rounded p-3">
            <Link href={`/app/schedules/${r.id}`} className="flex flex-col gap-1">
              <span className="font-medium">{r.label ?? "(unnamed)"}</span>
              <span className="text-sm text-muted-foreground">
                {formatDays(r.days_of_week)} {r.start_time}–{r.end_time} →
                {" "}<span className="italic">{(r.playlists as { name: string } | null)?.name ?? "(deleted)"}</span>
                {" · "}target:{" "}
                {r.target_device_id
                  ? (r.devices as { name: string } | null)?.name ?? "(deleted device)"
                  : (r.device_groups as { name: string } | null)?.name ?? "(deleted group)"}
              </span>
            </Link>
          </li>
        ))}
        {(!rules || rules.length === 0) && (
          <li className="text-muted-foreground">No rules yet.</li>
        )}
      </ul>
    </div>
  );
}
```

Create `dashboard/app/app/schedules/new/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { DaypartingRuleForm } from "@/components/dayparting-rule-form";
import { createRule } from "@/lib/actions/dayparting";

export default async function NewRulePage() {
  const supabase = await createClient();
  const [{ data: devices }, { data: groups }, { data: playlists }] = await Promise.all([
    supabase.from("devices").select("id, name").order("name"),
    supabase.from("device_groups").select("id, name").order("name"),
    supabase.from("playlists").select("id, name").order("name"),
  ]);

  async function submit(input: Parameters<typeof createRule>[0]) {
    "use server";
    return await createRule(input);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New dayparting rule</h1>
      <DaypartingRuleForm
        devices={devices ?? []}
        groups={groups ?? []}
        playlists={playlists ?? []}
        onSubmit={submit}
        submitLabel="Create rule"
      />
    </div>
  );
}
```

Create `dashboard/app/app/schedules/[id]/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { DaypartingRuleForm } from "@/components/dayparting-rule-form";
import { updateRule, deleteRule } from "@/lib/actions/dayparting";
import { Button } from "@/components/ui/button";

export default async function EditRulePage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: rule }, { data: devices }, { data: groups }, { data: playlists }] = await Promise.all([
    supabase.from("dayparting_rules").select("*").eq("id", id).maybeSingle(),
    supabase.from("devices").select("id, name").order("name"),
    supabase.from("device_groups").select("id, name").order("name"),
    supabase.from("playlists").select("id, name").order("name"),
  ]);
  if (!rule) notFound();

  async function save(input: Parameters<typeof updateRule>[1]) {
    "use server";
    return await updateRule(id, input);
  }
  async function remove() {
    "use server";
    await deleteRule(id);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit rule</h1>
      <DaypartingRuleForm
        initial={{
          name: rule.label ?? "",
          target_type: rule.target_device_id ? "device" : "device_group",
          target_id: rule.target_device_id ?? rule.target_device_group_id ?? "",
          days_of_week: rule.days_of_week,
          start_time: rule.start_time,
          end_time: rule.end_time,
          playlist_id: rule.playlist_id,
          effective_at: rule.effective_at,
        }}
        devices={devices ?? []}
        groups={groups ?? []}
        playlists={playlists ?? []}
        onSubmit={save}
        submitLabel="Save"
      />
      <form action={remove}>
        <Button type="submit" variant="destructive">Delete rule</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Smoke-test**

Create a rule targeting a device with a playlist, Mon–Fri 11:00–14:00. Verify it appears in the list showing "Mon–Fri 11:00–14:00". Edit, change days/time. Delete.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260422000075_dayparting_rule_label.sql dashboard/
git commit -m "feat(dash+db): dayparting rules CRUD with multi-day + label"
```

---

## Task 19: Enable pg_cron + offline-device alert function

**Files:**
- Create: `supabase/migrations/20260422000200_enable_pg_cron.sql`
- Create: `supabase/functions/alerts-device-offline/index.ts`
- Create: `supabase/functions/alerts-device-offline/deno.json`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Migration to enable pg_cron**

Create `supabase/migrations/20260422000200_enable_pg_cron.sql`:

```sql
-- pg_cron lives in the cron schema.
create extension if not exists pg_cron with schema extensions;

-- Grant usage so the Edge Function running as service_role can schedule jobs.
-- (Supabase automatically grants cron.schedule to postgres user; service_role
-- bypasses RLS but still needs function-level grants for pg_cron internals.)
grant usage on schema cron to postgres, service_role;
```

Run `supabase db reset` to apply. Then verify via Studio SQL editor:
```sql
select extname from pg_extension where extname = 'pg_cron';
```
Expected: one row.

- [ ] **Step 2: Write the Edge Function**

```bash
supabase functions new alerts-device-offline
```

Replace `supabase/functions/alerts-device-offline/index.ts`:

```ts
// supabase/functions/alerts-device-offline/index.ts
// Runs every 5 min via pg_cron. Finds devices whose last_seen_at is older than
// 30 minutes AND whose tenant owner hasn't already been alerted in the last
// hour, then sends one digest email per tenant via Resend. Idempotent per
// 1h window via the `alert_events` table.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("ALERTS_FROM_EMAIL");
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  if (!resendKey) throw new Error("RESEND_API_KEY must be set");
  if (!fromEmail) throw new Error("ALERTS_FROM_EMAIL must be set");

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Offline devices grouped by tenant, with owner email.
  const { data: rows, error } = await sb.from("devices")
    .select("id, name, last_seen_at, tenant_id, stores(name)")
    .lt("last_seen_at", cutoff);
  if (error) {
    console.error("query devices:", error);
    return new Response("query failed", { status: 500 });
  }

  const byTenant = new Map<string, typeof rows>();
  for (const r of rows ?? []) {
    const arr = byTenant.get(r.tenant_id) ?? [];
    arr.push(r);
    byTenant.set(r.tenant_id, arr);
  }

  let sent = 0;
  for (const [tenantId, devices] of byTenant) {
    // Dedupe: was an offline alert for this tenant sent within the last hour?
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await sb.from("alert_events")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("kind", "device_offline")
      .gt("created_at", oneHourAgo)
      .limit(1)
      .maybeSingle();
    if (recent) continue;

    // Tenant owner email.
    const { data: members } = await sb.from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "owner")
      .limit(1);
    const userId = members?.[0]?.user_id;
    if (!userId) continue;

    const { data: user } = await sb.auth.admin.getUserById(userId);
    const toEmail = user.user?.email;
    if (!toEmail) continue;

    const body = {
      from: fromEmail,
      to: [toEmail],
      subject: `${devices.length} TV${devices.length === 1 ? "" : "s"} offline > 30 min`,
      html: `<p>The following TVs have not reported in over 30 minutes:</p><ul>${
        devices.map(d => `<li><b>${d.name}</b> (${(d.stores as {name:string}|null)?.name ?? "?"}) — last seen ${d.last_seen_at ?? "never"}</li>`).join("")
      }</ul><p>Log into the dashboard to investigate.</p>`,
    };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`resend ${toEmail}: ${res.status} ${await res.text()}`);
      continue;
    }

    await sb.from("alert_events").insert({
      tenant_id: tenantId, kind: "device_offline", payload: { device_ids: devices.map(d => d.id) },
    });
    sent++;
  }

  return Response.json({ tenants_alerted: sent });
});
```

Create `supabase/functions/alerts-device-offline/deno.json`:

```json
{
  "imports": {}
}
```

Add to `supabase/config.toml`:

```toml
[functions.alerts-device-offline]
enabled = true
verify_jwt = false
import_map = "./functions/alerts-device-offline/deno.json"
entrypoint = "./functions/alerts-device-offline/index.ts"
```

- [ ] **Step 3: Add `alert_events` table**

Create `supabase/migrations/20260422000250_alert_events.sql`:

```sql
create table public.alert_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index alert_events_tenant_kind_time_idx
  on public.alert_events (tenant_id, kind, created_at desc);

alter table public.alert_events enable row level security;

create policy "alert_events: tenant members read"
  on public.alert_events for select
  using (tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid()));
-- No insert/update/delete for humans; only the Edge Function via service_role.
```

Run `supabase db reset`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260422000200_enable_pg_cron.sql supabase/migrations/20260422000250_alert_events.sql supabase/functions/alerts-device-offline supabase/config.toml
git commit -m "feat(fn): alerts-device-offline with pg_cron + Resend email digest"
```

---

## Task 20: Schedule the alerts function via pg_cron

**Files:**
- Create: `supabase/migrations/20260422000300_alerts_cron_schedule.sql`

- [ ] **Step 1: Migration to schedule the cron**

Create `supabase/migrations/20260422000300_alerts_cron_schedule.sql`:

```sql
-- Schedule the alerts function to run every 5 minutes. pg_cron calls it via
-- HTTP using the service-role key stored as a DB parameter (set by Supabase
-- automatically — supabase_service_role_key is always available).
--
-- NOTE: This DOES NOT run during local `supabase start` because local
-- Supabase bundles pg_cron but doesn't reliably execute its HTTP calls
-- against `http://host.docker.internal:54321`. Expect this to silently no-op
-- locally; it activates only on remote Supabase.

select cron.schedule(
  'alerts-device-offline-every-5min',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/alerts-device-offline',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
```

Note: `app.settings.supabase_url` and `app.settings.service_role_key` may not be set by Supabase automatically — confirm during remote deploy. If unavailable, we'll substitute direct values at deploy time.

- [ ] **Step 2: Verify via Studio**

Run `supabase db reset`. In Supabase Studio SQL editor:
```sql
select jobid, jobname, schedule, active from cron.job;
```
Expected: one row with jobname = 'alerts-device-offline-every-5min', schedule = '*/5 * * * *'.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260422000300_alerts_cron_schedule.sql
git commit -m "feat(db): schedule alerts-device-offline via pg_cron every 5 min"
```

---

## Task 21: Extend devices heartbeat schema + dashboard polish

**Why this task does three things:** Plan 1's `devices` table only stored `last_seen_at` + `cache_storage_info`. The spec §8 heartbeat PAYLOAD includes `app_version`, `current_playlist_id`, `last_config_version_applied`, `clock_skew_seconds_from_server` — these are received by the heartbeat endpoint but not persisted. The dashboard wants to display them. So: (1) migrate schema to add the columns, (2) update the heartbeat Edge Function to persist them, (3) display them in the UI.

**Files:**
- Create: `supabase/migrations/20260422000400_devices_heartbeat_fields.sql`
- Modify: `supabase/functions/devices-heartbeat/index.ts`
- Modify: `dashboard/components/device-status-badge.tsx`
- Modify: `dashboard/app/app/devices/[id]/page.tsx`

- [ ] **Step 1: Migration — add heartbeat observability columns**

Create `supabase/migrations/20260422000400_devices_heartbeat_fields.sql`:

```sql
alter table public.devices
  add column if not exists current_app_version text,
  add column if not exists current_playlist_id uuid references public.playlists(id) on delete set null,
  add column if not exists last_config_version_applied text,
  add column if not exists clock_skew_seconds_from_server int;
```

Run `supabase db reset` to apply.

- [ ] **Step 2: Update heartbeat Edge Function to persist these fields**

Replace `supabase/functions/devices-heartbeat/index.ts`:

```ts
// supabase/functions/devices-heartbeat/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { extractDeviceFromRequest } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const jwtSecret = Deno.env.get("DEVICE_JWT_SECRET");
  if (!jwtSecret) throw new Error("DEVICE_JWT_SECRET must be set");

  let claims;
  try {
    claims = await extractDeviceFromRequest(req, jwtSecret);
  } catch {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const svc = serviceRoleClient();
  const update: Record<string, unknown> = {
    last_seen_at: new Date().toISOString(),
    cache_storage_info: body.cache_storage_info ?? null,
  };
  if (typeof body.app_version === "string") update.current_app_version = body.app_version;
  if (typeof body.current_playlist_id === "string") update.current_playlist_id = body.current_playlist_id;
  if (typeof body.last_config_version_applied === "string") update.last_config_version_applied = body.last_config_version_applied;
  if (typeof body.clock_skew_seconds_from_server === "number") update.clock_skew_seconds_from_server = body.clock_skew_seconds_from_server;

  const { error } = await svc.from("devices").update(update).eq("id", claims.sub).is("revoked_at", null);
  if (error) return new Response("db: " + error.message, { status: 500 });

  return new Response(null, { status: 204 });
});
```

Restart the edge runtime:
```bash
docker restart supabase_edge_runtime_smart-tv-video-viewer
```

- [ ] **Step 3: Update heartbeat Deno test to assert new fields are persisted**

Modify `supabase/functions/tests/heartbeat.test.ts`: inside the existing test, after the heartbeat POST, SELECT from devices via the service client and assert `current_app_version = "0.1.0"` was stored. Full suite should still pass: 23 tests.

Run `deno task test` → 23/23 green.

- [ ] **Step 4: Extend status badge with warning variant**

Update `dashboard/components/device-status-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

type Props = {
  last_seen_at: string | null;
  clock_skew_seconds?: number | null;
};

export function DeviceStatusBadge({ last_seen_at, clock_skew_seconds }: Props) {
  if (!last_seen_at) return <Badge variant="secondary">Never paired</Badge>;
  const ageSec = (Date.now() - new Date(last_seen_at).getTime()) / 1000;
  const skewBad = Math.abs(clock_skew_seconds ?? 0) > 120;
  if (ageSec < 120) {
    return skewBad
      ? <Badge className="bg-amber-500">Online (clock skew)</Badge>
      : <Badge className="bg-green-600">Online</Badge>;
  }
  if (ageSec < 600) return <Badge className="bg-amber-500">Slow</Badge>;
  return <Badge variant="destructive">Offline</Badge>;
}
```

- [ ] **Step 5: Show extra heartbeat detail on device detail**

In `dashboard/app/app/devices/[id]/page.tsx`, expand the info section to include the new columns and `cache_events` last 10. Change the select to pull them:

```tsx
// Update the select to include:
const { data: device } = await supabase
  .from("devices")
  .select(`
    id, name, store_id, last_seen_at, fcm_token, fallback_playlist_id,
    cache_storage_info, current_app_version, current_playlist_id,
    last_config_version_applied, clock_skew_seconds_from_server,
    stores(name, timezone)
  `)
  .eq("id", id)
  .maybeSingle();

// cache_events uses a `state` column (not `kind`); values are
// 'cached' | 'failed' | 'evicted' | 'preloaded' per the Plan 1 schema.
const { data: recentCache } = await supabase.from("cache_events")
  .select("created_at, state, media_id, message")
  .eq("device_id", id)
  .order("created_at", { ascending: false })
  .limit(10);

// Replace the DeviceStatusBadge call with:
<DeviceStatusBadge
  last_seen_at={device.last_seen_at}
  clock_skew_seconds={device.clock_skew_seconds_from_server}
/>

// Add a new section after the heartbeat section:
<section className="border rounded p-4 space-y-2 text-sm">
  <h2 className="font-medium">Recent cache events</h2>
  {(!recentCache || recentCache.length === 0) ? (
    <p className="text-muted-foreground">No recent events.</p>
  ) : (
    <ul className="space-y-1">
      {recentCache.map((e, i) => (
        <li key={i} className="text-xs">
          <span className="text-muted-foreground">{e.created_at} </span>
          <span className="font-mono">{e.state}</span>
          {e.media_id && <span> · media {e.media_id.slice(0, 8)}…</span>}
          {e.message && <span> · {e.message}</span>}
        </li>
      ))}
    </ul>
  )}
</section>
```

- [ ] **Step 6: Smoke-test**

Pair a device, send a heartbeat via curl with app_version + clock_skew, send a cache_status event, visit the device detail page — expect the new fields and the cache event to render.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260422000400_devices_heartbeat_fields.sql \
  supabase/functions/devices-heartbeat/index.ts \
  supabase/functions/tests/heartbeat.test.ts \
  dashboard/
git commit -m "feat(db+fn+dash): devices heartbeat observability fields"
```

---

## Task 22: Playwright E2E — happy path

**Files:**
- Create: `dashboard/playwright.config.ts`
- Create: `dashboard/e2e/happy-path.spec.ts`
- Modify: `dashboard/package.json` (add playwright scripts)

- [ ] **Step 1: Install Playwright**

```bash
cd dashboard
pnpm add -D @playwright/test
pnpm exec playwright install chromium
cd ..
```

- [ ] **Step 2: Playwright config**

Create `dashboard/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.PLAYWRIGHT_NO_SERVER ? undefined : {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Happy path test**

Create `dashboard/e2e/happy-path.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test("login → create store → pair device → assign playlist", async ({ page, request }) => {
  const email = `e2e${Date.now()}@test.local`;
  const password = "P@ssw0rd123";

  // Admin-create the user so we can log in synchronously (magic-link in test is slow).
  const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });
  await svc.auth.admin.createUser({ email, password, email_confirm: true });

  // Sign in via password form manually — we'll override the login page's behaviour for testing
  // by directly using the client.
  await page.goto("/login");
  // For the actual test, we use Supabase JS directly to establish a session cookie via the
  // page context. Simpler: use a helper route in a dev-only env, OR accept magic link by
  // polling Inbucket. For v1 Playwright, easiest is to skip the login UI and seed the
  // session cookie via setCookie after signInWithPassword via the browserClient.
  await page.evaluate(async ({ url, anon, email, password }) => {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.0");
    const sb = createClient(url, anon);
    await sb.auth.signInWithPassword({ email, password });
  }, { url: URL, anon: ANON, email, password });

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();

  // Create a store.
  await page.getByRole("link", { name: "Stores" }).click();
  await page.getByRole("link", { name: "New store" }).click();
  await page.getByLabel("Name").fill("E2E Store");
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: "Stores" })).toBeVisible();
  await expect(page.getByText("E2E Store")).toBeVisible();

  // Request a pairing code via the Edge Function directly.
  const codeRes = await request.post(`${URL}/functions/v1/pairing-request`, {
    data: {},
    headers: { "content-type": "application/json" },
  });
  const { code } = await codeRes.json() as { code: string };

  // Pair flow in UI.
  await page.getByRole("link", { name: "Devices" }).click();
  await page.getByRole("link", { name: "Pair a TV" }).click();
  await page.getByLabel("Pairing code (from TV screen)").fill(code);
  await page.getByLabel("Store").selectOption({ label: "E2E Store" });
  await page.getByLabel("Device name").fill("Test TV");
  await page.getByRole("button", { name: "Pair TV" }).click();

  // Back on /app/devices, should see the new device.
  await expect(page.getByText("Test TV")).toBeVisible();

  // Cleanup: delete the user cascades the tenant + store + device.
  await svc.auth.admin.deleteUser((await svc.auth.admin.listUsers()).data.users.find(u => u.email === email)!.id);
});
```

- [ ] **Step 4: Add scripts**

Update `dashboard/package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 5: Run E2E**

```bash
# From repo root, make sure supabase is running:
supabase start  # if not already

# Run the test:
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" pnpm --filter dashboard test:e2e
```

Expect: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add dashboard/
git commit -m "test(dash): Playwright E2E covering login, store, pair, device visible"
```

---

## Task 23: Deploy to Vercel

**Files:**
- No code changes — pure configuration task.

- [ ] **Step 1: Install Vercel CLI (if not already)**

```bash
pnpm add -g vercel
vercel --version
```

- [ ] **Step 2: Link repo to Vercel**

From repo root:

```bash
cd dashboard
vercel link
```

Follow prompts:
- Set up project: yes
- Team: your personal account
- Project name: `smart-tv-dashboard`
- Directory: `./` (current — we're inside dashboard/)

- [ ] **Step 3: Configure env vars on Vercel**

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
# Paste: https://swhwrlpoqjijxcvywzto.supabase.co

vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
# Paste the anon key from .env.production

vercel env add SUPABASE_SERVICE_ROLE_KEY production
# Paste the service role key from .env.production
```

Also set same for preview + development scopes if desired.

- [ ] **Step 4: Configure rootDirectory**

In `vercel.json` at repo root (create if missing):

```json
{
  "buildCommand": "pnpm --filter dashboard build",
  "installCommand": "pnpm install --frozen-lockfile",
  "outputDirectory": "dashboard/.next",
  "framework": "nextjs"
}
```

- [ ] **Step 5: Deploy**

```bash
cd ..  # back to repo root
vercel --prod
```

Expect: URL returned. Visit it → login page loads → sign in via magic link (Inbucket won't work on Vercel; you need a real email to click). Verify sign-in works → app shell shows.

- [ ] **Step 6: Add Resend secrets to remote Supabase (for alerts)**

Get a Resend API key from https://resend.com/api-keys (signed up with a domain like `alerts@yourdomain`).

```bash
set -a; source .env.production; set +a
SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" supabase secrets set \
  RESEND_API_KEY="re_xxxxx" \
  ALERTS_FROM_EMAIL="alerts@yourdomain.com"
```

- [ ] **Step 7: Deploy new Edge Functions + run migrations on remote**

```bash
SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" SUPABASE_DB_PASSWORD="$SUPABASE_DB_PASSWORD" \
  supabase db push

SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" \
  supabase functions deploy media-upload-url --no-verify-jwt

SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" \
  supabase functions deploy alerts-device-offline --no-verify-jwt
```

- [ ] **Step 8: Smoke test the remote dashboard end-to-end**

Visit the Vercel URL, sign in with a real email, create a store, request a pairing code via curl against the remote Supabase URL, pair a TV (can be a placeholder "TV" for smoke), verify it shows in the device list.

- [ ] **Step 9: Commit**

```bash
git add vercel.json
git commit -m "chore(dash): add vercel.json for monorepo build config"
```

---

## Task 24: Update CLAUDE.md + MEMORY

**Files:**
- Modify: `CLAUDE.md` (update status + pointers)

- [ ] **Step 1: Update the project CLAUDE.md status**

Change the Status line at the top of `CLAUDE.md` to reflect Plan 2 done:

```
**Status (as of YYYY-MM-DD):** Plan 1 (backend) + Plan 2 (dashboard) complete. Dashboard live on Vercel at <URL>. Android TV app (Plans 3a/b/c) not yet written.
```

Add to Key file pointers:

```
- Plan 2 (dashboard): docs/superpowers/plans/2026-04-21-plan-2-dashboard.md
- Dashboard: dashboard/
- Vercel project: <project name / URL>
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): mark Plan 2 complete; add dashboard pointers"
```

---

## Post-Plan checks

- [ ] **All 24 tasks checked above.**
- [ ] **Dashboard live on Vercel.**
- [ ] **Full Deno test suite passes (`deno task test`), including the 2 new media-upload-url tests (25 total).**
- [ ] **pgtap: all schema + constraint + RLS tests pass, plus new tenant_bootstrap test.**
- [ ] **Playwright E2E: 1 passed.**
- [ ] **Remote: migrations, functions, secrets all in sync with local.**
- [ ] **pg_cron: `alerts-device-offline-every-5min` job active on remote.**
- [ ] **Resend: first test alert actually arrives at the tenant owner's email.**

## Exit criteria (Plan 2 is "done" when)

- All 24 tasks committed and pushed
- Vercel deploy green; real login + store + pair loop works end-to-end
- Tenant owner receives an offline-alert email for a device that's been red for 30+ min
- E2E Playwright test passes
- Dashboard code & docs merged to main

At that point, Plan 3a (Android TV pairing + cache skeleton) is unblocked.
