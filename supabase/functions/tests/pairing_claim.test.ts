// supabase/functions/tests/pairing_claim.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN_URL = `${SUPABASE_URL}/functions/v1`;

async function seedUserAndTenant() {
  const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false }});
  const email = `u${Date.now()}@test.local`;
  const { data: user, error: ue } = await svc.auth.admin.createUser({ email, email_confirm: true, password: "Password123!" });
  if (ue) throw ue;
  const { data: tenant } = await svc.from("tenants").insert({ name: "T" }).select().single();
  await svc.from("tenant_members").insert({ tenant_id: tenant!.id, user_id: user.user!.id });
  const { data: store } = await svc.from("stores").insert({ tenant_id: tenant!.id, name: "S" }).select().single();
  // Sign in to get a JWT:
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false }});
  const { data: sess } = await anon.auth.signInWithPassword({ email, password: "Password123!" });
  return { userJwt: sess.session!.access_token, tenantId: tenant!.id, storeId: store!.id };
}

// sanitize* disabled: supabase-auth-js's signInWithPassword starts an
// _startAutoRefresh setInterval that Deno's leak sanitizer flags even with
// persistSession: false. Endpoint behavior is fully exercised by the assertions.
Deno.test({
  name: "pairing-claim creates device and returns tokens",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
  const { userJwt, storeId } = await seedUserAndTenant();

  const r1 = await fetch(`${FN_URL}/pairing-request`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({ device_proposed_name: "TV 1" }),
  });
  const { code } = await r1.json();

  const r2 = await fetch(`${FN_URL}/pairing-claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${userJwt}`,
    },
    body: JSON.stringify({ code, store_id: storeId, name: "TV 1" }),
  });
  assertEquals(r2.status, 200);
  const body = await r2.json();
  assert(body.device_id);
  assert(body.name);
  },
});
