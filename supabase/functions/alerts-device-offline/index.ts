// supabase/functions/alerts-device-offline/index.ts
// Runs every 5 min via pg_cron. Finds devices whose last_seen_at is older than
// 30 minutes AND whose tenant owner hasn't already been alerted in the last
// hour, then sends one digest email per tenant via Brevo. Idempotent per
// 1h window via the `alert_events` table.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type Device = {
  id: string;
  name: string;
  last_seen_at: string | null;
  tenant_id: string;
  stores: { name: string } | { name: string }[] | null;
};

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  const fromEmail = Deno.env.get("ALERT_FROM_EMAIL");
  const fromName = Deno.env.get("ALERT_FROM_NAME") ?? "Alerts";
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  if (!brevoKey) throw new Error("BREVO_API_KEY must be set");
  if (!fromEmail) throw new Error("ALERT_FROM_EMAIL must be set");

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Offline devices grouped by tenant. `.lt()` excludes NULL last_seen_at so
  // never-heartbeated devices don't alert.
  const { data: rows, error } = await sb.from("devices")
    .select("id, name, last_seen_at, tenant_id, stores(name)")
    .lt("last_seen_at", cutoff);
  if (error) {
    console.error("query devices:", error);
    return new Response("query failed", { status: 500 });
  }

  const devices = (rows ?? []) as unknown as Device[];
  const byTenant = new Map<string, Device[]>();
  for (const r of devices) {
    const arr = byTenant.get(r.tenant_id) ?? [];
    arr.push(r);
    byTenant.set(r.tenant_id, arr);
  }

  let sent = 0;
  for (const [tenantId, tenantDevices] of byTenant) {
    // Dedup: was an offline alert for this tenant sent within the last hour?
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await sb.from("alert_events")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("kind", "device_offline")
      .gt("created_at", oneHourAgo)
      .limit(1)
      .maybeSingle();
    if (recent) continue;

    // Tenant owner email.
    const { data: members } = await sb.from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "owner")
      .limit(1);
    const userId = members?.[0]?.user_id;
    if (!userId) continue;

    const { data: user } = await sb.auth.admin.getUserById(userId);
    const toEmail = user.user?.email;
    if (!toEmail) continue;

    const storeName = (d: Device): string => {
      const s = d.stores;
      if (!s) return "?";
      // PostgREST joined relation may be single object or array; handle both.
      if (Array.isArray(s)) return s[0]?.name ?? "?";
      return s.name ?? "?";
    };

    const deviceList = tenantDevices.map(d =>
      `<li><b>${d.name}</b> (${storeName(d)}) — last seen ${d.last_seen_at ?? "never"}</li>`
    ).join("");
    const htmlContent = `<p>The following TVs have not reported in over 30 minutes:</p><ul>${deviceList}</ul><p>Log into the dashboard to investigate.</p>`;

    const brevoBody = {
      sender: { email: fromEmail, name: fromName },
      to: [{ email: toEmail }],
      subject: `${tenantDevices.length} TV${tenantDevices.length === 1 ? "" : "s"} offline > 30 min`,
      htmlContent,
    };

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": brevoKey,
      },
      body: JSON.stringify(brevoBody),
    });
    if (!res.ok) {
      console.error(`brevo ${toEmail}: ${res.status} ${await res.text()}`);
      continue;
    }
    // Drain Brevo's response body to avoid Deno resource leak warnings.
    await res.body?.cancel();

    await sb.from("alert_events").insert({
      tenant_id: tenantId,
      kind: "device_offline",
      payload: { device_ids: tenantDevices.map(d => d.id) },
    });
    sent++;
  }

  return Response.json({ tenants_alerted: sent });
});
