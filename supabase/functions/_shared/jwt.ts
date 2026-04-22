// supabase/functions/_shared/jwt.ts
import { create, verify, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

export type DeviceClaims = {
  sub: string;          // device_id
  tenant_id: string;
  role: "device";
  iat: number;
  exp: number;
};

async function importKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function mintDeviceAccessToken(params: {
  deviceId: string;
  tenantId: string;
  ttlSeconds: number;
  secret: string;
}): Promise<string> {
  const key = await importKey(params.secret);
  const now = Math.floor(Date.now() / 1000);
  const payload: DeviceClaims = {
    sub: params.deviceId,
    tenant_id: params.tenantId,
    role: "device",
    iat: now,
    exp: now + params.ttlSeconds,
  };
  return await create({ alg: "HS256", typ: "JWT" }, payload, key);
}

export async function verifyDeviceAccessToken(
  token: string,
  secret: string,
): Promise<DeviceClaims> {
  const key = await importKey(secret);
  const payload = await verify(token, key);
  if (
    typeof payload.sub !== "string" ||
    typeof (payload as Record<string, unknown>).tenant_id !== "string" ||
    payload.role !== "device" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("malformed device token");
  }
  return payload as unknown as DeviceClaims;
}

/** Generate a 64-char hex opaque refresh token. Stored server-side as SHA-256 hex. */
export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function hashRefreshToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
