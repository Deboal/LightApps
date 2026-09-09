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

/* A second client that is deliberately SESSION-BLIND, for an app that has no
   sign-in of its own.
 *
 * The session above being shared across the origin is a feature for apps that
 * want it and a trap for apps that don't. An app with no sign-in gets whatever
 * session the visitor happened to pick up from another app on the hub, and that
 * silently changes which Postgres role its requests arrive as -- `authenticated`
 * instead of `anon`. Different role, different policies, and a visitor who
 * signed in somewhere else can read nothing while a signed-out visitor reads
 * everything. That is not a theory: it is what happened to the seating board,
 * where one person saw the roster and the next saw an empty one.
 *
 * persistSession:false is what does the work -- the client never loads the
 * stored session, so every request carries the publishable key and nothing
 * else. The distinct storageKey means it cannot read or clobber the hub's
 * session either, so signing in elsewhere keeps working exactly as before. */
export const sbAnon = configured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "sb-anon-only-never-persisted",
      },
    })
  : null;
