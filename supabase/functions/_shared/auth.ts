// supabase/functions/_shared/auth.ts
import { verifyDeviceAccessToken, DeviceClaims } from "./jwt.ts";

export async function extractDeviceFromRequest(
  req: Request,
  secret: string,
): Promise<DeviceClaims> {
  const h = req.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) throw new Error("missing bearer");
  const token = h.slice(7);
  return await verifyDeviceAccessToken(token, secret);
}
