// supabase/functions/tests/_helpers.ts
// Shared test helper: seeds a user + tenant + store, signs in, runs the
// pairing-request → pairing-claim → pairing-status flow, and returns the
// freshly-paired device credentials for subsequent tests to call
// device-authenticated endpoints.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FN = `${SUPABASE_URL}/functions/v1`;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export type PairedDeviceCreds = {
  device_id: string;
  access_token: string;
  refresh_token: string;
  tenant_id: string;
  store_id: string;
  user_jwt: string;
};

export async function pairDevice(): Promise<PairedDeviceCreds> {
  const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const email = `u${Date.now()}${Math.random()}@test.local`;
  const { data: user } = await svc.auth.admin.createUser({
    email,
    email_confirm: true,
    password: "P@ssw0rd123",
  });
  const { data: tenant } = await svc.from("tenants").insert({ name: "T" }).select().single();
  await svc.from("tenant_members").insert({ tenant_id: tenant!.id, user_id: user.user!.id });
  const { data: store } = await svc
    .from("stores").insert({ tenant_id: tenant!.id, name: "S" }).select().single();
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data: sess } = await anon.auth.signInWithPassword({ email, password: "P@ssw0rd123" });
  const r1 = await fetch(`${FN}/pairing-request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const { code } = await r1.json();
  await fetch(`${FN}/pairing-claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${sess.session!.access_token}`,
    },
    body: JSON.stringify({ code, store_id: store!.id, name: "TV" }),
  });
  const pickup = await fetch(`${FN}/pairing-status?code=${code}`).then((r) => r.json());
  return {
    device_id: pickup.device_id,
    access_token: pickup.access_token,
    refresh_token: pickup.refresh_token,
    tenant_id: tenant!.id,
    store_id: store!.id,
    user_jwt: sess.session!.access_token,
  };
}
