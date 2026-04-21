// supabase/functions/pairing-request/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

function generateCode(len = 6): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.device_proposed_name === "string"
    ? body.device_proposed_name.slice(0, 80) : null;

  const sb = serviceRoleClient();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Retry until we get a unique code on the unclaimed unique index:
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const { error } = await sb.from("pairing_requests").insert({
      code,
      device_proposed_name: name,
      expires_at: expiresAt,
      created_from_ip: req.headers.get("x-forwarded-for") ?? null,
    });
    if (!error) {
      return Response.json({ code, expires_at: expiresAt });
    }
    if (!String(error.message).includes("duplicate")) {
      return new Response("db error: " + error.message, { status: 500 });
    }
  }
  return new Response("could not allocate code", { status: 503 });
});
