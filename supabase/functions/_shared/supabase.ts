// supabase/functions/_shared/supabase.ts
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export function serviceRoleClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
