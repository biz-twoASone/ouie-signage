// supabase/functions/_shared/fcm.ts
// Uses Firebase HTTP v1 API. Requires FCM_SERVICE_ACCOUNT_JSON (full service
// account JSON as a single-line string) and FCM_PROJECT_ID env vars. Both are
// checked loudly on every call site that needs them — consistent with the
// other _shared helpers (supabase.ts, r2.ts).

import { create as jwtCreate, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

type ServiceAccount = {
  private_key: string;
  client_email: string;
  token_uri: string;
};

export type FcmDispatchResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, "");
  const der = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getAccessToken(): Promise<string> {
  const saJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!saJson) throw new Error("FCM_SERVICE_ACCOUNT_JSON must be set");
  const sa: ServiceAccount = JSON.parse(saJson);

  const key = await importPrivateKey(sa.private_key);
  const jwt = await jwtCreate(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: sa.token_uri,
      exp: getNumericDate(3600),
      iat: getNumericDate(0),
    },
    key,
  );
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch(sa.token_uri, { method: "POST", body });
  if (!res.ok) throw new Error("token exchange failed: " + await res.text());
  const j = await res.json();
  return j.access_token as string;
}

export async function sendFcmSync(fcmToken: string): Promise<FcmDispatchResult> {
  const projectId = Deno.env.get("FCM_PROJECT_ID");
  if (!projectId) throw new Error("FCM_PROJECT_ID must be set");
  const at = await getAccessToken();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${at}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        data: { action: "sync" },
        android: { priority: "HIGH" },
      },
    }),
  });
  if (!res.ok) {
    // 500-char cap: FCM HTTP v1 error bodies are structured JSON (error.status +
    // error.message + optional error.details[]); typical size <400B. 500 preserves
    // the actionable prefix while bounding the `devices.last_fcm_dispatch_error`
    // text column. See https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
    const txt = await res.text();
    return { ok: false, error: `${res.status} ${txt.slice(0, 500)}` };
  }
  const body = await res.json().catch(() => ({}));
  const messageId = typeof body.name === "string" ? body.name : "";
  return { ok: true, messageId };
}
