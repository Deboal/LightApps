import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* Serves the built bundle. Supabase is stubbed per case, so this runs anywhere. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public");
const MIME = { ".html": "text/html", ".js": "text/javascript" };
function serve(port) {
  const s = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
    r.end(fs.readFileSync(f));
  });
  return new Promise((res) => s.listen(port, () => res(s)));
}
const server = await serve(0);
const PORT = server.address().port;
const fails = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const URL = "http://localhost:" + PORT + "/seating-board/";

async function run(label, handler, want, waitMs) {
  const ctx = await b.newContext({ viewport:{width:1400,height:900} });
  await ctx.addInitScript(() => localStorage.setItem("seating-board:pass","PJH903"));
  const page = await ctx.newPage();
  const errs=[]; page.on("pageerror",e=>errs.push(e.message));
  await page.route("**/realtime/**", r => r.abort());
  await page.route("**/rest/v1/**", handler);
  await page.goto(URL, { waitUntil:"domcontentloaded" });
  await page.waitForSelector(".plan-canvas", { timeout: 12000 });
  await page.waitForTimeout(waitMs || 1200);
  const shown = await page.locator('[data-el="notice"]').evaluate(e => e.hidden ? "(hidden)" : e.innerText.replace(/\s+/g," ").trim());
  const kind = await page.locator('[data-el="notice"]').getAttribute("data-kind");
  const badge = (await page.locator('[data-el="sync-text"]').textContent()).trim();
  const ok = want.test(shown);
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  [" + badge + "]");
  if (!ok) { fails.push(label + " -> " + shown.slice(0, 160)); }
  if (errs.length) fails.push(label + " threw: " + errs.join("; "));
  await ctx.close();
}

// 1. reads work, writes refused -> the policies-revoked fingerprint
await run("backend refusing (anon policy dropped)", async (route) => {
  const m = route.request().method();
  if (m === "GET") return route.fulfill({ status:200, contentType:"application/json",
    headers:{"access-control-allow-origin":"*"}, body:"[]" });
  return route.fulfill({ status:401, contentType:"application/json",
    headers:{"access-control-allow-origin":"*"},
    body: JSON.stringify({ message:"new row violates row-level security policy" }) });
}, /database is refusing this board/);

// 2. genuinely empty but writable -> the data really is gone
await run("empty but writable (rows genuinely gone)", async (route) => {
  const m = route.request().method();
  if (m === "GET") return route.fulfill({ status:200, contentType:"application/json",
    headers:{"access-control-allow-origin":"*"}, body:"[]" });
  return route.fulfill({ status:201, contentType:"application/json",
    headers:{"access-control-allow-origin":"*"}, body:"[]" });
}, /shared board is empty/);

// 3. backend unreachable
await run("backend unreachable", (route) => route.abort(), /Can.t reach the shared board/, 14000);

// 4. healthy with names -> no banner
await run("healthy, roster present", async (route) => {
  const u = route.request().url();
  let body = "[]";
  if (/collection=eq\.people/.test(u)) body = JSON.stringify([
    { doc_id:"p1", data:{ name:"Karen Hinton" }, updated_at:"2026-09-01T00:00:00Z" }]);
  if (/collection=eq\.layout/.test(u)) body = JSON.stringify([{ data:{ groups:[], rev:2 } }]);
  return route.fulfill({ status:200, contentType:"application/json",
    headers:{"access-control-allow-origin":"*"}, body });
}, /^\(hidden\)$/);

await b.close(); server.close();
if (fails.length) {
  console.error("backend-states FAILED");
  fails.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("backend-states ok — all four states report themselves");
