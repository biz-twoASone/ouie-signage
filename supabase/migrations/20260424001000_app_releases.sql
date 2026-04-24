-- supabase/migrations/20260424001000_app_releases.sql
-- Plan 5 Phase 1 Task 1.
-- OTA APK pointer per tenant. Single-row-per-tenant model: latest published
-- APK overwrites the previous one. We do not keep release history in v1 — the
-- monotonic version_code guard in apk-publish prevents accidental downgrades,
-- and rolling back is "publish an older artifact under a higher version_code"
-- (acceptable for a single-tenant self-use deployment).
ALTER TABLE tenants
    ADD COLUMN latest_apk_version_code int,
    ADD COLUMN latest_apk_version_name text,
    ADD COLUMN latest_apk_r2_path text,
    ADD COLUMN latest_apk_sha256 text,
    ADD COLUMN latest_apk_released_at timestamptz;

COMMENT ON COLUMN tenants.latest_apk_version_code IS
    'Android versionCode of the most-recently-published APK. Devices install when this exceeds BuildConfig.VERSION_CODE. NULL = no APK published yet.';
COMMENT ON COLUMN tenants.latest_apk_r2_path IS
    'R2 object key (e.g. tenants/<uuid>/apks/7.apk). devices-config presigns a 24h GET URL on each call.';
COMMENT ON COLUMN tenants.latest_apk_sha256 IS
    'Hex SHA-256 of the APK bytes. Device verifies after download and refuses install on mismatch.';
