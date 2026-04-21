# Smart TV Signage — v1 Design Spec

**Date:** 2026-04-21
**Status:** Approved (pending user spec review)
**Owner:** Anthony Gunawan
**Working mode:** Vibe-coded (Claude generates, user reviews + deploys)

---

## 1. Problem & success criteria

### Problem

Four F&B stores currently use YouTube playlists on 8 smart TVs (2 per store) to loop promotional content. Pain points:

- **Bandwidth cost** — continuous streaming (~20–40 GB/day/TV) across multiple stores.
- **Reliability** — TV screensavers / auto-off kill playback unpredictably.
- **Policy / ToS** — using YouTube for commercial display is against YouTube's terms.

### Goals for v1

- TVs play content from a local cache with near-zero streaming bandwidth during playback.
- Content can be updated centrally from a dashboard (desktop + phone web) and propagate to TVs without physical visits.
- Playback continues reliably through network drops; content survives reboots.
- Support dayparting (time-of-day / day-of-week schedules) AND scheduled publish (one-shot assignment changes with `effective_at`).
- Architecture is multi-tenant-ready at the schema level so a future productization does not require a rewrite. UX remains single-tenant for now.

### Explicitly NOT goals for v1

- Public signup, billing, Stripe — no productization yet.
- User management beyond the single owner (no team invites, roles, audit log).
- Plan limits / quotas, admin cross-tenant backend.
- SMS / Slack / WhatsApp alerts. Email-only.
- Automatic APK updates. (Manual sideload for now; self-update is v1.1.)
- Rich content: web views, YouTube embeds, live dashboards, text overlays.
- Transitions, effects, animations between playlist items.

---

## 2. Key decisions & rationale

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Option C — multi-tenant schema, single-tenant UX | Cheap (~15% overhead), preserves future productization; rejecting "full SaaS now" as premature without a paying stranger. |
| Scale | 4 stores × 2 TVs = 8 Android TV devices | User-confirmed. Single APK target; no Tizen. |
| Content assignment | Per-TV assignable, grouped via explicit user-created device groups | Flexibility without auto-implicit store grouping. |
| Scheduling | Dayparting (recurring) + scheduled publish (one-shot), unified as one primitive | User confirmed both are real operational needs. |
| Content format | MP4 video + JPEG/PNG images, with per-item duration for images | No web views or overlays in v1. |
| Sync behavior | Config poll every ~60s, media sync during low-bandwidth window + "Sync Now" push, cache-before-switch | Minimizes bandwidth; protects customer-facing playback from incomplete transitions. |
| Stack | Approach 1 — Supabase + Next.js + Kotlin Android TV APK + FCM + Cloudflare R2 | Fastest ship under AI-assisted pacing. User's skill profile: strong backend (5/5), competent frontend (3/5), zero Android (0/5 — acceptable in vibe-coding mode; user will have long-term maintenance dependency on AI assistance, flagged as accepted risk). |
| Upload flow | Responsive web dashboard (works on phone browser); WhatsApp bot deferred to post-v1 | Validates real need before investing in BSP integration. |
| Token rotation | IN v1: rotating refresh tokens with theft detection | Small cost (~2–4h iteration); good hygiene. |
| USB storage | IN v1: external storage as primary cache if present and larger | Many Android TVs have limited internal storage; USB is the pragmatic answer. |
| Preload-via-USB | IN v1: checksum-matched import from app-private preload folder | Enables sneakernet for bad-connectivity stores. |

---

## 3. Architecture

### Components

```
DASHBOARD (Next.js on Vercel)
  - Login (Supabase Auth, magic link)
  - Media library (upload, list, delete)
  - Playlist composer
  - Store + Device + Group management
  - Schedule editor (dayparting + scheduled publish)
  - "Sync Now" trigger
  - Device health view
        │
        │  HTTPS (REST + Supabase client SDK)
        ▼
SUPABASE (ap-southeast-1 Singapore)
  - Postgres with Row-Level Security
  - Auth (magic link for humans; custom JWT for devices)
  - Edge Functions (webhooks, FCM trigger, signed R2 URL minting)
  - pg_cron for scheduled jobs (offline-device alerts)
        │
        │  issues signed R2 URLs
        ▼
CLOUDFLARE R2 (media object storage)
  - Path: /tenants/{tenant_id}/media/{media_id}.{ext}
  - Direct-to-R2 upload from dashboard via presigned PUT
  - Device downloads via presigned GET (24h TTL)
        ▲
        │  media downloads during sync window
        │
ANDROID TV APK (Kotlin + Compose for TV + Media3/ExoPlayer)
  - Pairing → Running state machine
  - Config poller (60s interval, ETag-based)
  - Cache manager (internal or USB, LRU eviction)
  - Preload scanner (USB sneakernet import)
  - Schedule evaluator (local time + cached rules)
  - Playback engine (ExoPlayer for video, Compose Image + timer for images)
  - FCM listener ("sync now" push)
  - Boot receiver + foreground service (auto-launch & keep-alive)
  - Heartbeat (60s, health + cache status)
```

### Architectural principles

1. **Supabase owns multi-tenancy enforcement.** Every tenant-scoped table has `tenant_id`; RLS policies make cross-tenant leaks impossible at the application layer.
2. **Devices authenticate separately from users.** Users → magic link. Devices → pairing flow minting rotating JWTs.
3. **R2 carries bytes; Postgres carries metadata.** R2's zero-egress cost is essential with 8 devices repeatedly pulling media.
4. **Schedule evaluation happens on-device.** Server ships rules; device computes "what plays now" against its own NTP-synced, timezone-adjusted clock. Playback survives server outages.
5. **FCM is an optimization, not a dependency.** Config polling (60s) is the baseline; FCM "sync now" just reduces latency. Polling works if FCM is unreliable on MIUI forks.
6. **The TV never interrupts customer-facing playback for sync-plane errors.** Only three screens customers ever see: current playlist, "Preparing content…" (transient), or "No content configured."

---

## 4. Data model

Postgres schema. Every tenant-scoped table has `tenant_id` with RLS enforcement.

### Tables

```sql
-- Tenancy
tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)

tenant_members (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL DEFAULT 'owner',
  PRIMARY KEY (tenant_id, user_id)
)

-- Physical layout
stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',    -- IANA tz

  -- Sync window (in store-local time)
  sync_window_start time NOT NULL DEFAULT '02:00',
  sync_window_end time NOT NULL DEFAULT '05:00'
)

devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid NOT NULL REFERENCES stores(id),
  name text NOT NULL,

  -- Pairing
  pairing_code text UNIQUE,                       -- nullable after pairing completes

  -- Auth (rotating refresh token)
  refresh_token_hash text,                        -- nullable before pairing
  refresh_token_issued_at timestamptz,
  refresh_token_last_used_at timestamptz,
  access_token_ttl_seconds int NOT NULL DEFAULT 3600,

  -- FCM
  fcm_token text,

  -- Playback
  fallback_playlist_id uuid REFERENCES playlists(id),

  -- Health
  last_seen_at timestamptz,
  cache_storage_info jsonb,                       -- see schema below

  -- Lifecycle
  revoked_at timestamptz,                         -- kill-switch
  created_at timestamptz NOT NULL DEFAULT now()
)

-- Device groups (user-explicit; no auto-implicit store groups)
device_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)

device_group_members (
  device_group_id uuid NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  PRIMARY KEY (device_group_id, device_id)
)

-- Content
media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('video', 'image')),
  r2_path text NOT NULL,                          -- /tenants/{tid}/media/{id}.{ext}
  original_filename text,
  size_bytes bigint NOT NULL,
  checksum text NOT NULL,                         -- sha256 hex
  video_duration_seconds numeric,                 -- nullable; set for videos only
  uploaded_at timestamptz NOT NULL DEFAULT now()
)

playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)

playlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media(id),
  position int NOT NULL,
  duration_seconds numeric,                       -- required for images; optional override for videos
  UNIQUE (playlist_id, position)
)

-- Scheduling primitive (unifies dayparting + scheduled publish)
dayparting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  playlist_id uuid NOT NULL REFERENCES playlists(id),

  -- Exactly one target:
  target_device_id uuid REFERENCES devices(id),
  target_device_group_id uuid REFERENCES device_groups(id),
  CONSTRAINT rule_single_target CHECK (
    (target_device_id IS NOT NULL) <> (target_device_group_id IS NOT NULL)
  ),

  -- Rule timing (evaluated in device.store.timezone):
  days_of_week int[] NOT NULL,                    -- ISO: 1=Mon .. 7=Sun
  start_time time NOT NULL,
  end_time time NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),-- rule activates at this server-time

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
)

-- Pairing state (short-lived)
pairing_requests (
  code text PRIMARY KEY,                          -- 6-char alphanumeric
  device_proposed_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  claimed_at timestamptz,
  claimed_device_id uuid REFERENCES devices(id)
)
```

### Indexes

```sql
CREATE INDEX ON devices (tenant_id);
CREATE INDEX ON devices (last_seen_at);
CREATE INDEX ON media (tenant_id);
CREATE INDEX ON playlists (tenant_id);
CREATE INDEX ON playlist_items (playlist_id, position);
CREATE INDEX ON dayparting_rules (target_device_id, effective_at DESC)
  WHERE target_device_id IS NOT NULL;
CREATE INDEX ON dayparting_rules (target_device_group_id, effective_at DESC)
  WHERE target_device_group_id IS NOT NULL;
CREATE INDEX ON device_group_members (device_id);
CREATE INDEX ON pairing_requests (expires_at);
```

### `cache_storage_info` JSONB shape

```json
{
  "root": "internal" | "external",
  "filesystem": "ext4" | "exfat" | "fat32" | "unknown",
  "uuid": "<uuid>",                  // for external only
  "total_bytes": 17179869184,
  "free_bytes": 12884901888,
  "updated_at": "2026-04-21T10:00:00Z",
  "preload": {
    "path": "/storage/.../preload",
    "present": true,
    "file_count": 4,
    "matched_count": 3,
    "unmatched": [
      {"filename": "teaser.mp4", "size_bytes": 2300000000, "sha256": "...", "seen_at": "..."}
    ]
  }
}
```

### RLS policies + device access (refined during Plan 1 writing)

Two principal types, two enforcement styles:

**Humans:** RLS policies on every tenant-scoped table, enforced by Postgres:

```sql
CREATE POLICY human_tenant_access ON <table>
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );
```

**Devices:** NOT routed through RLS. Device-facing Edge Functions verify the device JWT manually (signature + `devices.revoked_at IS NULL` check), extract `device_id` + `tenant_id`, then use the **service-role** Supabase client with explicit `WHERE tenant_id = <claim>` filtering. Rationale: Supabase's RLS model is anchored to `auth.uid()` / `auth.users`; fitting a non-human principal into it requires creating synthetic auth-user rows or doing custom `SET LOCAL` acrobatics. A cleaner separation is: humans → RLS; machines → service-role with application-layer tenant enforcement in a small number of audited Edge Functions.

Security properties are identical (cross-tenant reads impossible), and the attack surface is smaller (a handful of reviewed functions, not every table).

Device JWT claims: `{sub: device_id, tenant_id, role: 'device', iat, exp}`. Access tokens only; refresh tokens validated separately at `/refresh` endpoint.

### Precedence rules (device-side resolver)

```
active_playlist(device, now_local) =
  first rule from {
    rules where target_device_id = device.id
    UNION
    rules where target_device_group_id IN (device's group IDs)
  }
  WHERE effective_at <= server_now
    AND now_local.weekday IN days_of_week
    AND start_time <= now_local.time <= end_time
  ORDER BY
    target_device_id IS NOT NULL DESC,   -- device-specific beats group
    effective_at DESC                    -- newer wins within same scope
  ELSE device.fallback_playlist_id
```

---

## 5. Authentication & authorization

### User auth

Supabase magic-link. `auth.users` → `tenant_members` → tenant scope. Single owner in v1; no team invites.

### Device auth: pairing flow

1. TV on first boot has no tokens → calls `POST /api/pairing/request`. Server generates 6-char alphanumeric code (confusables excluded: 0/O, 1/I/l), TTL 15 min, rate-limited per IP.
2. TV displays code: `"Pair this TV: ABC-123"`.
3. User (logged in to dashboard) enters code, picks store, optional device name, submits `POST /api/pairing/claim`.
4. Server inserts `devices` row, mints refresh token + access JWT, stores `refresh_token_hash` (bcrypt or sha256), deletes `pairing_requests` row.
5. TV polls `/api/pairing/status` every 3s (for up to 15 min); when status=paired, receives `{access_token, refresh_token, device_id, store_id, timezone}`.
6. TV stores `refresh_token` in Android `EncryptedSharedPreferences`, `access_token` in memory, transitions to Running state.

### Device auth: rotating refresh tokens

- **Access JWT:** short-lived (TTL 1h), signed with Supabase JWT secret. Claims include `device_id`, `tenant_id`, `role: 'device'`. Validated cryptographically — no DB hit.
- **Refresh token:** opaque long-lived string. Only the hash is stored on `devices.refresh_token_hash`.
- **Rotation on every use.** `POST /api/devices/me/refresh` with `{refresh_token}` → server validates hash match → mints new access JWT **and new refresh token** → updates `refresh_token_hash` and `refresh_token_last_used_at` → returns both tokens.
- **Theft detection.** If a refresh token is presented whose hash doesn't match the current `refresh_token_hash`, log a `theft_detected` event on that device and return 401. This forces the real device to fall back to re-pairing (which the operator will see and notice).
- **Revocation.** Setting `devices.revoked_at = now()` makes next access-JWT validation (via a database check in the Edge Function verifying the device isn't revoked) and next refresh both fail. Instant kill-switch.
- **Clock skew.** Client does NOT pre-check expiry; waits for 401 and refreshes on demand.

### OkHttp integration on device

An `Authenticator` catches 401 on any API call, runs the refresh flow under a mutex (to serialize concurrent refreshes), and retries the original request. If refresh itself 401s, clear tokens and transition back to Pairing state.

---

## 6. Flows

### 6.1 Config sync (every 60s)

```
TV: GET /api/devices/me/config
    Authorization: Bearer <access_jwt>
    If-None-Match: "sha256:<last_version>"

Server:
    compute config_version = sha256 of canonical JSON of {
      device, rules (effective), playlists referenced,
      playlist_items, media metadata including signed URLs
    }
    if config_version == If-None-Match → 304 Not Modified
    else → 200 with full config + ETag header

TV on 200:
    parse
    diff old vs new media set:
      - NEW media → enqueue for sync
      - GONE media → mark LRU-eligible (don't delete yet)
    update cached rules, fallback_playlist
    DO NOT switch playback immediately; playback loop handles that (6.3)
```

**Signed R2 URLs have 24h TTL.** Regenerated whenever config is regenerated. Device can download anytime during that window.

### 6.2 Media sync window

- Source: `stores.sync_window_start` / `stores.sync_window_end` (store-local time). Default `02:00–05:00`; operator-editable per store in the dashboard store-settings view.
- Edge cases: if `sync_window_end < sync_window_start`, the window crosses midnight (e.g., `22:00–04:00`) — resolver treats this correctly.
- Triggers: (a) arriving at start of window with queued media, (b) FCM "Sync Now" push regardless of clock.
- Strategy: serial downloads (one at a time) to avoid thrashing weak WiFi.
- Per file: stream to temp → verify sha256 → atomic rename to cache → report `cache_status` update to server → next file.
- On checksum mismatch: delete temp, log, retry once, then defer to next window.
- On download fail mid-stream: delete partial, retry once, defer to next window.

### 6.3 Playback loop (cache-before-switch)

```
every tick (~1 Hz):
  now_local = NTP-synced time in device.store.timezone
  desired = resolve_from_rules(device, now_local)  // precedence rules

  if desired is null:
    show "No content configured" screen
    return

  if desired.fully_cached():
    if current_playing != desired:
      log switch event
      current_playing = desired
      reset to first item
    advance item (ExoPlayer for video; Compose Image + coroutine timer for image)
    on item finish: advance position, loop at end
  else:
    // don't interrupt customer-facing playback
    if current_playing exists and still cached:
      continue playing current_playing
    else:
      show "Preparing content…" screen
      trigger sync-now (debounced)
```

**Schedule-switch-with-incomplete-cache policy:** keep playing the previous cached playlist until the desired playlist is fully cached. Dashboard surfaces a warning: `"Device X missed 11:00 lunch switch — cache incomplete, retrying."`

### 6.4 "Sync Now" push

```
Dashboard → POST /api/devices/{id}/sync-now  (or /api/device-groups/{id}/sync-now)
Server → FCM data message { action: "sync" } → device's fcm_token
TV FirebaseMessagingService → wake → poll config → fetch media → report status
```

FCM is best-effort. Fallback is the 60s poll. Dashboard optimistically shows "sync triggered"; final completion visible via updated `cache_status` in heartbeat.

### 6.5 Cache storage (internal vs USB)

**At app startup (with three-tier fallback for Risk #1):**

1. **Primary:** `Context.getExternalFilesDirs(null)` → enumerate returned paths.
2. **Secondary (if primary fails or returns anomalous):** `StorageManager.getStorageVolumes()` + `getDirectory()` on each volume.
3. **Tertiary:** internal only (`getFilesDir()`), flag `cache_storage_info.degraded = true` in heartbeat so dashboard surfaces it.

Choose root: whichever candidate has the most free space, with a minimum 4 GB threshold to prefer external.

**Layout (wherever `<cache_root>` lives):**

```
<cache_root>/media/<media_id>.<ext>   -- cached files
<cache_root>/media.db                  -- SQLite index: media_id, path, checksum, cached_at, last_played_at
<cache_root>/../preload/               -- operator-placed sneakernet files (sibling of cache)
<cache_root>/../preload_index.db       -- (path, size, mtime, hash) → skip re-hashing unchanged files
```

**Edge cases:**

- USB yanked mid-run → halt → "Preparing content…" → re-evaluate storage → USB returns (resume) or fall back to internal and re-download on next sync.
- Disk full → LRU evict non-referenced files; if still full, warn in heartbeat, play whatever fits.
- Different USB plugged (new UUID) → treat as empty cache; rebuild.
- FAT32 > 4 GB file → reject, warn operator to reformat as exFAT. Filesystem type in heartbeat drives dashboard recommendation.

### 6.6 Preload-via-USB

**Operator workflow:**
1. Upload videos to dashboard normally (R2 gets files; checksums in Postgres).
2. On laptop, copy the same files onto USB at: `<usb_root>/Android/data/com.yourapp.signage/files/preload/` — app-private, no SAF picker needed.
3. Plug USB into TV, power on.

**App scan (at startup + at start of each sync window):**

```
for each file in preload_dir:
  if file unchanged (path, size, mtime in preload_index.db):
    skip
  hash = sha256(file)
  record (path, size, mtime, hash) in preload_index.db

  if hash matches any media.checksum in current config AND media not cached:
    atomic-move file into cache as <cache>/media/<media_id>.<ext>
    update media.db
    log event to heartbeat: "preloaded media_id=X from USB"
  else if no match:
    log to heartbeat "unmatched preload: <filename>, sha256=..., size=..."
```

**Never auto-deletes preload files.** Dashboard has explicit "Clear preload folder" action; otherwise files remain (operator-owned space).

**Hashing cost:** ~10–30s per GB on mid-tier Android TV SoC. One-time per file; cached in `preload_index.db`.

### 6.7 Boot & auto-launch (Risk #2 defense-in-depth)

Four layers:

1. `BOOT_COMPLETED` receiver → launches main Activity.
2. `QUICKBOOT_POWERON` receiver (MIUI-specific fast-boot intent).
3. Declare `LEANBACK_LAUNCHER` category on main Activity → app appears on TV home screen for manual launch.
4. Foreground service with `START_STICKY` → survives process kills; if killed, system attempts restart.

**Operator fallback:** documented "If the app doesn't auto-launch, press Home and open 'Signage Player'." This runbook ships with the setup guide.

---

## 7. Error handling

The guiding principle: **customer-facing playback never displays an error.** Only three screens are ever customer-visible:

- Current playlist (normal operation)
- "Preparing content…" (transient, cold start or post-USB-yank)
- "No content configured" (config-zero case)

### Network errors

| Scenario | Behavior |
|---|---|
| Config poll timeout / 5xx | Exponential backoff (1, 2, 4, 8, …, capped 60s). Keep playing cached content. |
| Access JWT expired (401) | Run refresh flow; if refresh 401s, clear tokens, return to pairing screen. |
| Media download fail mid-stream | Delete partial, retry once, defer to next sync window. |
| Checksum mismatch | Delete file, log, retry in next window. No retry loop. |

### Storage / cache errors

| Scenario | Behavior |
|---|---|
| USB yanked | Playback halts, "Preparing content…", re-evaluate storage. |
| Disk full after eviction | Warn via heartbeat; play whatever fits. |
| Silent corruption (checksum fail on cached file) | Evict and re-download. |
| `preload_index.db` / `media.db` corruption | Rebuild from disk scan. |

### Playback errors

| Scenario | Behavior |
|---|---|
| Video codec/malformed file | Skip item, log `playback_failed` with media_id, advance. |
| Image decode fail | Same — skip, log, advance. |
| Playlist all-items-fail | Show "No content" until config changes. |
| ExoPlayer crash / ANR | Foreground service restarts Activity. Crash loop (3 restarts in 60s) → safe-mode screen. |

### Server errors

| Scenario | Behavior |
|---|---|
| Postgres outage | Supabase multi-AZ handles. Extended outage: TVs keep playing cached content. |
| R2 outage | Media downloads fail gracefully; cached content continues. |
| FCM outage | "Sync Now" silently falls back to next 60s poll. |

---

## 8. Monitoring & observability

### Heartbeat (every 60s)

TV → `POST /api/devices/me/heartbeat` with:

```json
{
  "app_version": "0.1.0",
  "uptime_seconds": 123456,
  "current_playlist_id": "...",
  "last_config_version_applied": "sha256:...",
  "clock_skew_seconds_from_server": 3,
  "cache_storage_info": { /* see schema in §4 */ },
  "errors_since_last_heartbeat": [
    {"timestamp": "...", "kind": "download_failed", "media_id": "...", "message": "..."}
  ]
}
```

### Dashboard device detail view

- **Status indicator:**
  - 🟢 Green: seen < 2 min, cache healthy, playing expected playlist
  - 🟡 Amber: seen < 10 min, has warnings (partial cache, schedule-switch-deferred, storage low, clock skew)
  - 🔴 Red: not seen > 10 min OR errors reported
- **Now playing:** playlist + item + elapsed
- **Cache status:** `4.2 GB / 15 GB used on USB (exFAT). 23/23 media cached. Next sync: 02:00 local.`
- **Connectivity sparkline:** heartbeats over last 24h — intermittent network becomes visible instantly.
- **Recent errors:** last 20, auto-clear after 72h.
- **Preload status:** matched / unmatched lists (from `cache_storage_info.preload`).

### Alerts (v1 minimum)

- Email the tenant owner when any device is red for > 30 min. Implemented as a Supabase Edge Function triggered by `pg_cron` every 5 min.
- **That is the entire v1 alert system.** No SMS, Slack, WhatsApp. Add later if email is ignored.

### Clock-skew monitoring

Heartbeat includes `clock_skew_seconds_from_server`. Dashboard flags > 120s. Schedule accuracy depends on this.

---

## 9. Testing strategy

### Backend (Supabase + Next.js)

- **Unit:** pure logic (schedule resolver, config version hasher, checksum verification) — vitest, ~80% coverage target on these modules.
- **Integration:** Supabase local (`supabase start`, Docker) — test RLS explicitly with cross-tenant attack paths. **Highest priority:** a dedicated `rls_isolation.spec.ts` that asserts no cross-tenant reads under any query shape.
- **API:** Next.js route handlers via supertest with test JWTs.

### Dashboard

- **Component tests (vitest + RTL):** playlist composer, schedule editor, group assignment.
- **E2E (Playwright):** one happy path — login → upload media → create playlist → schedule → pair device → see device online.
- **Responsive:** Playwright iPhone viewport smoke test for phone-upload flow.

### Android TV app

- **Unit (JVM junit):** pure-logic modules only — schedule resolver, cache LRU, checksum verification, config-diff. No Android deps.
- **Instrumented (Espresso):** at most pairing screen + one playback scenario. Don't over-invest in Android UI tests for 8 physical TVs.
- **Ship with extensive logging.** Every state transition, network event, cache decision. Rolling 1 MB log ships with heartbeat. Dashboard: "View device logs" button.
- **Real-hardware validation:** two weeks of dogfooding in actual stores before declaring v1 "done."

### CI (GitHub Actions)

- Backend tests + dashboard tests + Android unit tests on every PR.
- Android APK built as artifact; no automated deploy — manual sideload to TVs.

---

## 10. Known risks & fallbacks

| # | Risk | Severity | Fallback / mitigation |
|---|---|---|---|
| 1 | USB behavior unverified on user's TVs — `getExternalFilesDirs(null)` may not expose mounted USB on all Android TV forks | Medium | Three-tier fallback (getExternalFilesDirs → StorageManager.getStorageVolumes → internal-only). Dashboard surfaces "external storage unavailable" warning. Prototype verification deferred until user has physical device access. |
| 2 | Auto-launch on boot may not fire on MIUI TV forks | Medium | Four-layer defense (BOOT_COMPLETED + QUICKBOOT_POWERON + LEANBACK_LAUNCHER + foreground service). Operator runbook for manual launch. Prototype deferred. |
| 3 | FCM delivery unreliable on MIUI (battery optimization kills receivers) | Low | 60s polling is the baseline; FCM only reduces latency. If FCM fails, "Sync Now" has 60s max delay. Acceptable. |
| 4 | APK distribution is manual for v1 | Low | Accepted for v1. Self-update via R2-hosted version file is v1.1. |
| 5 | RLS policy bug leaking cross-tenant data | **High** (would be catastrophic post-productization) | Dedicated test suite. Policy linting in CI. In v1 only one tenant exists (user), so exposure is zero; must be solid before onboarding any second tenant. |
| 6 | TV clock drift breaking schedule evaluation | Low | NTP runs automatically on Android TV with internet. Heartbeat reports `clock_skew_seconds_from_server`; dashboard warns > 120s. |
| 7 | User cannot maintain Android codebase independently (skill profile 0/5 Kotlin) | Medium | Accepted with open eyes. Long-term maintenance depends on AI assistance. Code structured for readability + extensive inline-doc comments where behavior is non-obvious. |
| 8 | Video file > 4 GB on FAT32-formatted USB | Low | Heartbeat reports filesystem type; dashboard recommends exFAT. Worst case: download fails with clear error. |

---

## 11. Out of scope (explicit, to hold the line on scope creep)

- Public signup, email verification for signup
- Billing, subscriptions, Stripe, plan-based quotas
- User management UI (team invites, roles, permissions)
- Cross-tenant admin backend
- Audit log
- Push notifications to operator (beyond email)
- SMS / Slack / WhatsApp alerting
- WhatsApp bot for media upload (deferred to post-v1; validate need operationally first)
- Content: web views, YouTube embeds, text-over-image overlays, Canva / Google Slides integration
- Transitions, animations, fades between playlist items
- Live / streaming content (always-on dashboards, live camera feeds)
- Automatic APK updates (v1.1)
- Manifest-file-driven preload (v1 uses hash-match)
- Live USB cache migration (v1 is evaluate-at-startup)
- Signed preload manifests, RAID-like multi-USB striping
- Hardware abstraction for non-Android-TV devices

---

## 12. v1.1+ backlog (captured for future reference)

- APK self-update via R2-hosted version file
- WhatsApp bot intake for media upload
- Device groups: auto-implicit per-store groups (if the explicit-only approach proves tedious)
- Signed preload manifests (exported from dashboard as a ZIP operator drops onto USB)
- Richer dashboard: per-media analytics (play count, skip count via heartbeat aggregation)
- Proactive cache warming (start downloading future-scheduled playlists well in advance)
- Device remote-reboot / factory-reset command channel
- Bulk device operations in the dashboard UI
- Transitions/fades between items
- Sound on/off + volume control per device
- Content-creation tools (text over background, simple menu templates)

---

**End of v1 design spec.**
