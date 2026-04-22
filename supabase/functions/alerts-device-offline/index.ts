// supabase/functions/alerts-device-offline/index.ts
// Runs every 5 min via pg_cron. For each tenant that has opted in to alerts
// (alerts_enabled=true), finds devices whose last_seen_at is older than the
// tenant's configured threshold, dedup-checks the last hour of alert_events,
// then sends one digest email via Brevo to the tenant's configured recipient
// (fallback: owner auth email). Idempotent per 1h window.
//
// Uptime-rule gate (Plan 2.2): only devices that are currently within at least
// one expected-on window (screen_uptime_rules) generate an alert. Devices with
// no applicable rule are silent by default.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isInWindow } from "../_shared/schedule.ts";

type Device = {
  id: string;
  name: string;
  last_seen_at: string | null;
  tenant_id: string;
  store_id: string | null;
  stores: { name: string; timezone: string } | { name: string; timezone: string }[] | null;
};

type TenantCfg = {
  id: string;
  alerts_enabled: boolean;
  alert_offline_threshold_minutes: number;
  alert_recipient_email: string | null;
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

  const { data: tenants, error: tErr } = await sb
    .from("tenants")
    .select("id, alerts_enabled, alert_offline_threshold_minutes, alert_recipient_email")
    .eq("alerts_enabled", true);
  if (tErr) {
    console.error("query tenants:", tErr);
    return new Response("query failed", { status: 500 });
  }

  let sent = 0;
  for (const tenant of (tenants ?? []) as TenantCfg[]) {
    const cutoff = new Date(
      Date.now() - tenant.alert_offline_threshold_minutes * 60 * 1000,
    ).toISOString();

    const { data: rows, error } = await sb
      .from("devices")
      .select("id, name, last_seen_at, tenant_id, store_id, stores(name, timezone)")
      .eq("tenant_id", tenant.id)
      .lt("last_seen_at", cutoff);
    if (error) {
      console.error(`query devices tenant=${tenant.id}:`, error);
      continue;
    }
    const candidates = (rows ?? []) as unknown as Device[];
    if (candidates.length === 0) continue;

    // Fetch uptime rules for this tenant (both device-level and group-level).
    const { data: allRules } = await sb
      .from("screen_uptime_rules")
      .select("target_device_id, target_device_group_id, days_of_week, start_time, end_time")
      .eq("tenant_id", tenant.id);

    // Fetch group memberships (device_id → group_id[]).
    // device_group_members has no tenant_id column; scoping via .in("device_id", candidates)
    // is safe because candidates is already tenant-scoped from the devices query above.
    const { data: memberships } = await sb
      .from("device_group_members")
      .select("device_id, device_group_id")
      .in("device_id", candidates.map((d) => d.id));
    const deviceToGroups = new Map<string, string[]>();
    for (const m of memberships ?? []) {
      const arr = deviceToGroups.get(m.device_id) ?? [];
      arr.push(m.device_group_id);
      deviceToGroups.set(m.device_id, arr);
    }

    // Filter candidates to those currently within an expected-on window.
    // Devices with no store timezone or no applicable rule are silent (default-silent).
    const now = new Date();
    const offline = candidates.filter((d) => {
      const tz = Array.isArray(d.stores) ? d.stores[0]?.timezone : d.stores?.timezone;
      if (!tz) return false; // no store/timezone → cannot evaluate → silent

      const deviceRules = (allRules ?? []).filter((r) => r.target_device_id === d.id);
      const rulesToCheck = deviceRules.length > 0
        ? deviceRules
        : (allRules ?? []).filter((r) => {
            if (!r.target_device_group_id) return false;
            const groups = deviceToGroups.get(d.id) ?? [];
            return groups.includes(r.target_device_group_id);
          });

      return rulesToCheck.some((r) =>
        isInWindow(now, tz, r.days_of_week, r.start_time as string, r.end_time as string),
      );
    });

    if (offline.length === 0) continue;

    // 1h dedup per tenant/kind.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await sb
      .from("alert_events")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("kind", "device_offline")
      .gt("created_at", oneHourAgo)
      .limit(1)
      .maybeSingle();
    if (recent) continue;

    let toEmail = tenant.alert_recipient_email;
    if (!toEmail) {
      const { data: members } = await sb
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", tenant.id)
        .eq("role", "owner")
        .limit(1);
      const userId = members?.[0]?.user_id;
      if (!userId) continue;
      const { data: user } = await sb.auth.admin.getUserById(userId);
      toEmail = user.user?.email ?? null;
    }
    if (!toEmail) continue;

    const storeName = (d: Device): string => {
      const s = d.stores;
      if (!s) return "?";
      if (Array.isArray(s)) return s[0]?.name ?? "?";
      return s.name ?? "?";
    };

    const deviceList = offline
      .map(
        (d) =>
          `<li><b>${d.name}</b> (${storeName(d)}) — last seen ${d.last_seen_at ?? "never"}</li>`,
      )
      .join("");
    const htmlContent = `<p>The following TVs have not reported in over ${tenant.alert_offline_threshold_minutes} minutes:</p><ul>${deviceList}</ul><p>Log into the dashboard to investigate.</p>`;

    const brevoBody = {
      sender: { email: fromEmail, name: fromName },
      to: [{ email: toEmail }],
      subject: `${offline.length} TV${offline.length === 1 ? "" : "s"} offline > ${tenant.alert_offline_threshold_minutes} min`,
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
    await res.body?.cancel();

    await sb.from("alert_events").insert({
      tenant_id: tenant.id,
      kind: "device_offline",
      payload: {
        device_ids: offline.map((d) => d.id),
        threshold_minutes: tenant.alert_offline_threshold_minutes,
        recipient: toEmail,
      },
    });
    sent++;
  }

  return Response.json({ tenants_alerted: sent });
});
