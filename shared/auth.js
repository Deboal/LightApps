// auth.js — shared sign-in for every hub app (email magic link).
//
// Wrap an app's root in <AuthGate> and it requires sign-in; children receive the user.
//   import { AuthGate } from "../../../shared/auth.js";
//   <AuthGate>{(user) => <App user={user} />}</AuthGate>
//
// Sign-in is passwordless: the user enters an email, gets a magic link, clicks it,
// and lands back here signed in. The session is shared across all apps on this origin.

import React, { useState, useEffect } from "react";
import { sb, configured } from "./client.js";

export async function signInWithEmail(email, redirectTo) {
  if (!sb) throw new Error("Backend not configured");
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo || window.location.href },
  });
  if (error) throw error;
}

export async function signOut() { if (sb) await sb.auth.signOut(); }

// undefined = still loading, null = signed out, object = signed in
export function useAuth() {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    if (!sb) { setUser(null); return; }
    sb.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => setUser(session?.user || null));
    return () => sub.subscription.unsubscribe();
  }, []);
  return user;
}

const C = { bg: "#0f1318", panel: "#161c23", line: "#2a333d", text: "#e7edf2", dim: "#8b97a3", accent: "#33c2b0", danger: "#e5604d" };

function Center({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: C.bg, color: C.text, fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' }}>
      <div style={{ maxWidth: 420, width: "100%", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 28 }}>{children}</div>
    </div>
  );
}

export function AuthGate({ children }) {
  const user = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  if (!configured) return <Center><b>Backend not configured.</b><p style={{ color: C.dim }}>Set SUPABASE_URL and SUPABASE_KEY in shared/config.js.</p></Center>;
  if (user === undefined) return <Center><span style={{ color: C.dim }}>Loading…</span></Center>;
  if (user) return typeof children === "function" ? children(user) : children;

  if (sent) return <Center><h2 style={{ margin: "0 0 8px" }}>Check your email</h2><p style={{ color: C.dim, lineHeight: 1.6 }}>We sent a sign-in link to <b>{email}</b>. Open it on this device to continue.</p></Center>;

  const send = async () => {
    setErr(null);
    if (!/.+@.+\..+/.test(email.trim())) return setErr("Enter a valid email.");
    setBusy(true);
    try { await signInWithEmail(email.trim()); setSent(true); }
    catch (e) { setErr(e.message || "Sign-in failed."); }
    setBusy(false);
  };

  const input = { width: "100%", background: C.bg, border: `1px solid ${C.line}`, color: C.text, borderRadius: 9, padding: "11px 13px", fontSize: 15, outline: "none", marginBottom: 12 };
  const btn = { width: "100%", background: C.accent, color: "#06231f", border: "none", borderRadius: 10, padding: "11px 16px", fontWeight: 700, fontSize: 15, cursor: "pointer" };

  return (
    <Center>
      <div style={{ fontSize: 11, letterSpacing: ".22em", color: C.dim, fontWeight: 600 }}>APP HUB</div>
      <h2 style={{ margin: "6px 0 14px" }}>Sign in</h2>
      <input style={input} type="email" placeholder="you@email.com" value={email}
        onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
      {err && <div style={{ color: C.danger, fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <button style={btn} disabled={busy} onClick={send}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
      <p style={{ color: C.dim, fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>No password. You'll get a one-time link. One sign-in works across every app in the hub.</p>
    </Center>
  );
}
