# Smart TV Signage — project notes

**Status (as of 2026-04-22):** **Plan 1 complete. Plan 2 mid-execution.** Plan 2 written as `docs/superpowers/plans/2026-04-21-plan-2-dashboard.md` and executing on branch `feature/plan-2-dashboard`. **Batches A, B, C done.** All verified via Playwright E2E against a real browser: magic-link login, tenant auto-provisioning, stores CRUD, pair-TV flow, devices list/detail, Sync Now (202 from FCM), **R2 two-phase upload** (presigned PUT → browser SHA-256 → finalize → object lands in R2 `signage-ouie-media` bucket). Remote Supabase project `signage-ouie` (ref `swhwrlpoqjijxcvywzto`) has all 16 migrations applied and all 8 Plan 1 Edge Functions deployed; the new `media-upload-url` Edge Function + `20260422000050_media_pending_support` migration are local-only — they get pushed at the end of Batch E (before Vercel deploy) or when a remote test is needed. R2 bucket CORS configured for `http://localhost:3000` with `AllowedHeaders: ["Content-Type"]` (minimum needed for preflight); add production Vercel URL in Batch F. Remote `site_url` / `additional_redirect_urls` still local-only. Next: Batch D (Tasks 14–17, playlists composer + device/store/group assignment).

**Stack divergences from Plan 2 text, accepted by user on 2026-04-21:** scaffolder produced Next.js 16 / React 19 / Tailwind v4 instead of 15/18/v3. Decision: stay on current stack; keep `middleware.ts` (not `proxy.ts`) for Plan 2 duration; translate Tailwind v3 config references to CSS-first `@theme` edits in `dashboard/app/globals.css`; `toast` became `sonner` (shadcn 4.4.0 forced). See memory `project_plan2_stack_divergence.md`.

## Do not re-brainstorm

Design is final and committed. Do NOT:
- Re-run the brainstorming skill unless the user explicitly asks to reconsider scope
- Re-evaluate "should we use React Native / Xibo / other stack" — Kotlin Android TV + Supabase + Next.js + FCM + R2 is locked; user accepted the skill-gap trade-off consciously
- Re-suggest scope changes (single-tenant vs SaaS) — Option C is locked: multi-tenant schema, single-tenant UX

## Resume protocol

Before doing anything in this project:

1. Read `docs/superpowers/specs/2026-04-21-signage-v1-design.md` (the spec).
2. List active plans in `docs/superpowers/plans/`. A plan is "mid-execution" if git log shows commits stopping partway through its tasks. Plan 1 is DONE as of 2026-04-21. Plan 2+ are not yet written.
3. Run `git log --oneline -20` and `git branch --show-current` to see where execution stopped.
4. If mid-plan: use `superpowers:subagent-driven-development` to continue task-by-task. Do NOT invoke `brainstorming` or `writing-plans`.
5. If between plans (previous plan done, next not yet written): ASK the user before starting the next plan. Don't auto-start writing-plans — user may want to deploy/test first, or defer.
6. Check `~/.claude/projects/-Users-anthonygunawan-Sandbox-ai-projects-smart-tv-video-viewer/memory/MEMORY.md` for accumulated context (user profile, prior decisions, feedback rules).

## Key file pointers

- Spec: `docs/superpowers/specs/2026-04-21-signage-v1-design.md`
- Plan 1 (current): `docs/superpowers/plans/2026-04-21-plan-1-backend-foundation.md`
- Plans 2, 3a/b/c, remaining — not yet written. See spec §1–3 for the roadmap. After each plan finishes, the next one is written via `superpowers:writing-plans`.

## Conventions decided during this project

- **Commits per task.** Each plan task ends with its own commit. Commit messages follow conventional-commits (`feat(db):`, `feat(fn):`, `test(db):`, `chore:`). Match the exact message specified in the plan task.
- **Timestamped migrations.** `supabase/migrations/YYYYMMDDhhmmNN_<slug>.sql`. Tightly ordered; later migrations depend on earlier ones.
- **RLS is for humans only.** Device endpoints go through Edge Functions using the Supabase service-role client with explicit `WHERE tenant_id = <claim>` filtering. Do NOT add RLS policies for device roles — that approach was considered and rejected during spec refinement.
- **No placeholders, no TODOs.** If you catch yourself about to write `// TODO: implement later`, stop and either finish it or escalate to the user.
- **TDD for non-trivial Edge Functions.** Migration tasks are not TDD (the schema SQL is itself the spec); Edge Function tasks write Deno tests first, implement, run tests, commit.
- **Edge runtime does not hot-reload.** After editing any `supabase/functions/**/*.ts` file while `supabase functions serve` is already running, the container serves the old code until restarted. Run `docker restart supabase_edge_runtime_smart-tv-video-viewer` (or kill + re-run `supabase functions serve --env-file .env.local`) before re-running Deno tests — otherwise a "fix" appears not to take effect.
- **Test runner.** Run the full Deno integration suite via `deno task test` (defined in root `deno.json`). The task passes `--env-file=.env.local` so you don't need to source env manually. If you add a test that pulls env vars directly, they'll come from `.env.local` too.
- **`.env.local` values — quote them.** `.env.local` is loaded both by `supabase functions serve --env-file .env.local` (edge runtime) and by `deno test --env-file=.env.local` (test process). When editing values, wrap in double quotes: `KEY="value"`. Unquoted JWTs containing `-` characters get truncated by bash when sourced (service-role key ending in `...yH-qQwv...` was silently truncated at `yH-` in an earlier edit).
- **Reading `.env*` files is denied — don't try.** Global `~/.claude/settings.json` denies `Read(./.env)` and `Read(./.env.*)`, which covers `.env.local`, `.env.production`, and even `.env.example`. Don't attempt `Read`/`cat` on them — you'll just hit a permission wall. The project works around this with the `dotenv` npm package wired into `dashboard/next.config.ts` (`dotenv.config({ path: "../.env.local" })`), so Next.js server actions and route handlers get secrets on `process.env.X` at runtime without Claude ever seeing file contents. Edge Functions get them via `--env-file .env.local` (same idea, different loader). **Practical rules for future sessions:** (1) reference secrets in code as `process.env.KEY_NAME` (Next) or `Deno.env.get("KEY_NAME")` (Deno) — never inline values; (2) to discover which keys exist, grep the codebase for `process.env\.` / `Deno.env.get`, check `dashboard/next.config.ts` for what dotenv loads, or ask the user — do NOT try to read `.env.example`; (3) if you need the user to add a new key, tell them the exact name and where to put it (root `.env.local` for Edge/Deno, also surfaces in Next via the dotenv wiring); (4) the `dotenv` import is intentional even though Next.js has built-in `.env.local` support — it's load-path explicit (root-level file from the `dashboard/` subdir) and documents the pattern. Don't remove it.
- **PostgREST schema cache staleness.** After `supabase db reset`, PostgREST can still serve the old schema cache; `NOTIFY pgrst, 'reload schema'` alone isn't always enough. Fix: `docker restart supabase_rest_smart-tv-video-viewer`. Same pattern as the edge runtime restart.

## Stack summary (one-liner for fresh Claude)

Supabase (Postgres + RLS + Edge Functions in Deno) + Cloudflare R2 (S3-compatible media storage) + Firebase Cloud Messaging + Next.js dashboard (Plan 2) + Kotlin/Compose-for-TV/Media3 Android TV APK (Plans 3a/b/c). User skill profile: backend/Supabase/SQL = 5/5, Next.js = 3/5, Android = 0/5. Vibe-coding mode: AI generates, user reviews and deploys.

## Execution pacing rule

User prefers **batch execution with natural-boundary pauses** over full autonomy or task-by-task approval. Group by natural phase (e.g., all migrations → pause → RLS + tests → pause → shared modules → pause → each endpoint cluster). Announce batch boundaries and report progress; continue unless the user intervenes.

## Review depth calibration

Per the subagent-driven-development skill, every task gets spec + code-quality reviews. But scale effort to complexity:

- **Trivial single-file SQL migrations with exact spec content:** one combined spec + quality review is sufficient (pattern used for Tasks 2–11).
- **Edge Function tasks (multi-file, integration logic, auth):** run spec-compliance and code-quality reviewers as separate dispatches. Different reviewers catch different classes of issue.
- **Any task touching auth, RLS, or cross-tenant isolation:** always use separate two-stage review, no shortcuts. Cross-tenant leakage is the highest-severity v1 risk.
