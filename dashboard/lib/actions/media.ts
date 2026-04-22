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
