# Smart TV Signage — project notes

**Status (as of 2026-04-21):** **Plan 1 complete.** All 27 tasks committed; 23/23 Deno integration tests pass; pgtap (schema + constraints + RLS isolation) PASS. Local E2E green. Next: write Plan 2 (Next.js dashboard) via `superpowers:writing-plans` — but only when the user says go. Pre-Plan-2 there are two loose ends worth deciding first: (a) deploy Plan 1 artifacts to the remote Supabase project (see Post-Plan checks at the bottom of the plan file), and (b) the `.env.local` env-pointing quirk noted below.

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
- **`.env.local` env pointing quirk.** As of end-of-Plan-1, `.env.local` points at a remote Supabase project (not `127.0.0.1:54321`), and the remote has no migrations applied. Tests therefore need env overrides to run green against local: recover local demo keys via `supabase status -o env`, then prefix `deno test` commands with `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local> SUPABASE_SERVICE_ROLE_KEY=<local>`. Not fixed yet — worth a decision: either point `.env.local` at local, or introduce a separate `.env.test` / `.env.production` split. Pending user call.
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
