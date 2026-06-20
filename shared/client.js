// One shared Supabase client for the whole hub (auth + data + storage all use this).
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const configured =
  /^https:\/\/.+\.supabase\.co/.test(SUPABASE_URL) && !!SUPABASE_KEY && !SUPABASE_KEY.startsWith("PASTE");

// persistSession + detectSessionInUrl let a magic-link click land back signed in,
// and the session is shared across every app on this origin.
export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
