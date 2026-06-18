// Shared Supabase config for every app in the hub.
// These are PUBLIC values and are safe to commit. The real security boundary is
// Row Level Security in Postgres, not these strings.
// Fill these in once (SETUP.md, step 1). Copy them, do not retype.
export const SUPABASE_URL = "https://fycvuanvyjujtyjsmyaf.supabase.co";     // https://<ref>.supabase.co
export const SUPABASE_KEY = "sb_publishable_fqukDTDrWlTU_w-ZLXyyPw_p2rSiiYW"; // sb_publishable_... (or legacy anon)
