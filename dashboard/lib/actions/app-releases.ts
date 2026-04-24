// Plan 5 Phase 1 Task 5.
// Server actions for the "App Releases" page. Three operations:
//   - getCurrentRelease: read the tenant's currently-published APK pointer
//   - requestApkUploadUrl: call apk-upload-url Edge Function, get presigned R2 PUT URL
//   - publishApkRelease: call apk-publish Edge Function, finalize the pointer
// Mirrors the two-phase pattern in `dashboard/lib/actions/media.ts`.
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ReleaseRow = {
  version_code: number | null;
  version_name: string | null;
  released_at: string | null;
  sha256: string | null;
};

export async function getCurrentRelease(): Promise<ReleaseRow | null> {
  const supabase = await createClient();
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return null;
  const { data } = await supabase.from("tenants").select(
    "latest_apk_version_code, latest_apk_version_name, latest_apk_released_at, latest_apk_sha256",
  ).eq("id", tm.tenant_id).maybeSingle();
  if (!data) return null;
  return {
    version_code: data.latest_apk_version_code,
    version_name: data.latest_apk_version_name,
    released_at: data.latest_apk_released_at,
    sha256: data.latest_apk_sha256,
  };
}

export async function requestApkUploadUrl(input: {
  versionCode: number;
  sizeBytes: number;
}): Promise<
  { r2_path: string; upload_url: string; expires_at: string } | { error: string }
> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/apk-upload-url`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      version_code: input.versionCode,
      size_bytes: input.sizeBytes,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    return { error: `apk-upload-url: ${res.status} ${t}` };
  }
  return await res.json();
}

export async function publishApkRelease(input: {
  versionCode: number;
  versionName: string;
  r2Path: string;
  sha256: string;
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/apk-publish`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      version_code: input.versionCode,
      version_name: input.versionName,
      r2_path: input.r2Path,
      sha256: input.sha256,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    return { error: `apk-publish: ${res.status} ${t}` };
  }
  revalidatePath("/app/app-releases");
  return { ok: true };
}
