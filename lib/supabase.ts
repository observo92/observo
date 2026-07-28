import { createClient } from "@supabase/supabase-js";

// Public client — safe to use in browser/client components. Respects RLS
// (read-only access to raw_snapshots + verdicts, per rls_policies.sql).
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Admin client — server-only (cron routes, scripts). Bypasses RLS entirely
// via the service_role key. Never import this from a client component.
export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
