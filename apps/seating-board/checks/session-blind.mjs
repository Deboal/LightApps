/* session-blind.mjs — the board must talk to Supabase as `anon`, always.
 *
 * Guarding a one-word regression with a real cost. The hub's Supabase session
 * is shared across the origin, so a visitor who signed in to another app here
 * carries that session into this board, which has no sign-in of its own. Their
 * requests then arrive as the `authenticated` role rather than `anon` — a
 * different role, a different set of policies, and an empty board.
 *
 * That is not hypothetical. Ted reported "I refreshed, signed in and no names
 * still" while an unsigned browser showed the full roster, and the difference
 * was exactly this. `store(..., { anon: true })` is what fixes it, and deleting
 * those two words would break it again with nothing else looking wrong.
 *
 * What this asserts is the Authorization header the board sends, not what the
 * server does with it — the header is the whole bug, and it can be checked
 * without the network. Supabase is stubbed, so this runs anywhere.
 *
 *   node apps/seating-board/checks/session-blind.mjs
 *
 * Needs a built bundle (bash build.sh) and playwright available.
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../public");
const CONFIG = fs.readFileSync(path.resolve(HERE, "../../../shared/config.js"), "utf8");
const KEY = /SUPABASE_KEY\s*=\s*"([^"]+)"/.exec(CONFIG)[1];
const REF = /https:\/\/([^.]+)\.supabase\.co/.exec(CONFIG)[1];
const SESSION_JWT = "someone.elses.session.token";

const MIME = { ".html": "text/html", ".js": "text/javascript" };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    r.writeHead(404); r.end(); return;
  }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise((res) => server.listen(0, res));
const base = "http://localhost:" + server.address().port + "/seating-board/";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();

/* A visitor signed in to some other app on the hub, exactly as supabase-js
   would have left it, plus the board's shared password already accepted. */
await ctx.addInitScript(([ref, jwt]) => {
  localStorage.setItem("sb-" + ref + "-auth-token", JSON.stringify({
    access_token: jwt, token_type: "bearer", expires_at: 4102444800,
    refresh_token: "r", user: { id: "someone", email: "someone@example.com" },
  }));
  localStorage.setItem("seating-board:pass", "PJH903");
}, [REF, SESSION_JWT]);

const sent = [];
const page = await ctx.newPage();
await page.route("**/rest/v1/**", async (route) => {
  sent.push(String(route.request().headers()["authorization"] || ""));
  const body = /collection=eq\.people/.test(route.request().url())
    ? JSON.stringify([{ doc_id: "p1", data: { name: "Karen Hinton" }, updated_at: "2026-09-01T00:00:00Z" }])
    : "[]";
  await route.fulfill({
    status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body,
  });
});
await page.route("**/realtime/**", (r) => r.abort());

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".plan-canvas", { timeout: 15000 });
await page.waitForTimeout(600);

const fails = [];
if (!sent.length) fails.push("the board made no Supabase requests at all");
if (sent.some((a) => a.includes(SESSION_JWT))) {
  fails.push("the board sent the visitor's session token, so its requests arrive as " +
             "`authenticated` and not `anon` — check store(..., { anon: true })");
}
if (!sent.every((a) => a.includes(KEY))) {
  fails.push("not every request carried the publishable key");
}
const names = await page.locator('[data-el="pool"] .chip .nm').allTextContents();
if (!names.includes("Karen Hinton")) fails.push("the stubbed roster did not reach the board");

await browser.close();
server.close();

if (fails.length) {
  console.error("session-blind FAILED");
  fails.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("session-blind ok — " + sent.length + " requests, all as anon; roster rendered");
