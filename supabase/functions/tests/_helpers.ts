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

function unwrap<T>(r: { data: T | null; error: unknown }, ctx: string): NonNullable<T> {
  if (r.error) {
    throw new Error(
      `pairDevice: ${ctx}: ${(r.error as { message?: string }).message ?? String(r.error)}`,
    );
  }
  if (r.data === null || r.data === undefined) {
    throw new Error(`pairDevice: ${ctx}: no data returned`);
  }
  return r.data as NonNullable<T>;
}

// Supabase auth responses are discriminated unions where the error branch has
// `data` typed as a fully-null-filled object rather than `null`. Normalize to
// the `{ data: T | null; error }` shape that `unwrap` expects so we get the
// same throw-on-error semantics.
function normalizeAuth<T>(r: { data: T; error: unknown } | { data: unknown; error: unknown }): {
  data: T | null;
  error: unknown;
} {
  const err = (r as { error: unknown }).error;
  return { data: err ? null : (r as { data: T }).data, error: err };
}

async function postJson(url: string, init: RequestInit, ctx: string): Promise<unknown> {
  const r = await fetch(url, init);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`pairDevice: ${ctx}: HTTP ${r.status}: ${body}`);
  }
  return await r.json();
}

export async function pairDevice(): Promise<PairedDeviceCreds> {
  const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const email = `u${Date.now()}${Math.random()}@test.local`;

  const createUserRes = unwrap(
    normalizeAuth<{ user: { id: string } | null }>(
      await svc.auth.admin.createUser({
        email,
        email_confirm: true,
        password: "P@ssw0rd123",
      }),
    ),
    "admin.createUser",
  );
  const userId = createUserRes.user?.id;
  if (!userId) throw new Error("pairDevice: admin.createUser: user is null");

  // The on_auth_user_created trigger auto-creates a tenant + tenant_members row
  // for each new user (owner role). Read the trigger-created tenant_id rather
  // than inserting a second one — inserting again would leave the user with
  // two tenant_members rows and break any caller that assumes one-tenant-per-user
  // (e.g. media-upload-url's .maybeSingle() lookup).
  const bootstrap = unwrap<{ tenant_id: string }>(
    await svc.from("tenant_members").select("tenant_id").eq("user_id", userId).single(),
    "select auto-bootstrapped tenant_members",
  );
  const tenant = { id: bootstrap.tenant_id };

  const store = unwrap<{ id: string }>(
    await svc.from("stores").insert({ tenant_id: tenant.id, name: "S" }).select().single(),
    "insert stores",
  );

  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const signIn = unwrap(
    normalizeAuth<{ session: { access_token: string } | null }>(
      await anon.auth.signInWithPassword({ email, password: "P@ssw0rd123" }),
    ),
    "signInWithPassword",
  );
  const userJwt = signIn.session?.access_token;
  if (!userJwt) throw new Error("pairDevice: signInWithPassword: session is null");

  const r1 = await postJson(
    `${FN}/pairing-request`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    "pairing-request",
  ) as { code?: string };
  const code = r1.code;
  if (!code) throw new Error("pairDevice: pairing-request: missing code");

  await postJson(
    `${FN}/pairing-claim`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${userJwt}`,
      },
      body: JSON.stringify({ code, store_id: store.id, name: "TV" }),
    },
    "pairing-claim",
  );

  const pickup = await postJson(
    `${FN}/pairing-status?code=${code}`,
    {},
    "pairing-status",
  ) as { device_id?: string; access_token?: string; refresh_token?: string };

  if (!pickup.device_id || !pickup.access_token || !pickup.refresh_token) {
    throw new Error(
      `pairDevice: pairing-status: incomplete pickup ${JSON.stringify(pickup)}`,
    );
  }

  return {
    device_id: pickup.device_id,
    access_token: pickup.access_token,
    refresh_token: pickup.refresh_token,
    tenant_id: tenant.id,
    store_id: store.id,
    user_jwt: userJwt,
  };
}
