# LightApps — guide for Claude

A hub of small, self-owned web apps that share one Supabase backend and deploy
to one Netlify site. See `SETUP.md` for the one-time backend/Netlify setup and
`AUTH-SETUP.md` for the magic-link auth details.

## Repo layout

- `apps/<name>/index.html` + `apps/<name>/src/app.jsx` — one app per folder.
- `shared/` — one Supabase client (`client.js`), the namespaced data helper
  (`store.js`), and shared magic-link sign-in (`auth.js`), plus `config.js`
  (public Supabase URL + publishable key; safe to commit).
- `build.sh` — bundles every `apps/*/src/app.jsx` into `public/<name>/` with
  esbuild and generates the landing page. Netlify runs it via `netlify.toml`.
  It also picks up three optional sidecars per app:
  `apps/<name>/src/*worker.js` gets its own bundle (a Worker needs its own entry
  point; load it as `new Worker("worker.js")`), `apps/<name>/assets/` is
  copied verbatim for anything the app fetches at runtime, and
  `apps/<name>/sw.js` is copied as a service worker with `__BUILD__` replaced
  by a hash of everything it precaches — so a changed build is a changed
  worker and one atomic cache swap, rather than a version constant someone has
  to remember to bump.
- React + esbuild only. No framework, no router — each app is a standalone
  bundle served at `/<name>/`.

## Building a new app

1. Create `apps/<name>/index.html` (copy an existing one; change the `<title>`)
   and `apps/<name>/src/app.jsx`. Match the existing style (dark theme, inline
   styles, `createRoot(...).render(...)` at the bottom).
2. Decide on backend needs:
   - **Needs saved/shared data** → use the shared store and wrap in `AuthGate`:
     ```js
     import { store } from "../../../shared/store.js";
     import { AuthGate, signOut } from "../../../shared/auth.js";
     const db = store("<name>");              // per-user private
     const db = store("<name>", {shared:true}); // shared across users
     ```
     `gear-tracker` is the reference example (~80 lines).
   - **Self-contained / no data** → skip auth and the network entirely. Better
     UX for casual or offline use (no sign-in friction). `concert-line` is the
     reference: purely client-side, `localStorage` for state.
3. Verify before committing: `bash build.sh` must build with no errors. For UI,
   smoke-test in headless Chromium (`/opt/pw-browsers/chromium`, Playwright is
   available) at a phone viewport — confirm it renders and has no console
   errors. `public/` and `node_modules/` are gitignored; don't commit them, and
   don't add test-only deps (e.g. playwright) to `package.json`.

## Deploying (this is the important part)

Deploy is **git-driven**: there is no manual deploy step and no Netlify CLI here.

1. Push the branch and open a PR (ready for review, not draft).
2. **Merge the PR to `main`.** Netlify watches `main`, runs `bash build.sh`, and
   publishes `public/`. Live in ~30–60s at `https://<hub>.netlify.app/<name>/`,
   and the app auto-appears on the landing page. Watch progress under **Deploys**
   in the Netlify dashboard.

Iterating is the same loop: edit → PR → merge → redeploys shortly after.

## Offline for an app with a backend

`make-offline.sh` refuses anything that imports `shared/client|store|auth` or
ships an `assets/` folder, and it is right to: a `file://` page needing
Supabase just spins. An app that is *local-first* rather than self-contained
wants the other approach — a service worker, so the app that reads the
device's data is available without a connection too. `apps/gba/sw.js` is the
worked example, and its one rule is worth stealing: precache the whole shell
in a single pass into a cache named for the build, and never revalidate a file
on its own. Two halves of one program cached out of step is a worse failure
than being offline.

## Offline single-file export (for self-contained apps)

For an app with no backend, you can hand the user one file that runs offline
(great for spotty signal): `bash make-offline.sh <name>` writes
`offline/<name>.html` with the bundle inlined. It refuses apps that import
`shared/client|store|auth`, since a `file://` page needing Supabase just spins —
and likewise apps with an `assets/` folder or a worker, whose sidecar files it
does not inline.
Verify the result by loading it as a `file://` URL with all network requests
blocked. `offline/` is gitignored; the file is a build artifact to hand over,
not something to commit.

## Generated data an app carries

`apps/gba/assets/world.*` is the worked example: map data derived from a
pokefirered checkout by `tools/gen-world.mjs`, committed rather than built.
Netlify has no checkout and should not need one, and the input never changes.
The rules that make this safe rather than sloppy: the generator is in the repo
and takes the source path as an argument, the output is small enough to read
the size of in a diff (about 28 KB gzipped), and the app gates on it — a
cartridge the data does not describe loads no data and falls back, rather than
navigating Emerald with Kanto's walls.

## Server-side secrets

`shared/config.js` holds public values only. Anything that must not reach a
browser — an API key for a paid service — goes in a Supabase Edge Function
under `supabase/functions/<name>/`, with the value stored as a project secret
and read via `Deno.env.get`. Leave "Verify JWT" on so the function is only
reachable by a signed-in user; it is the only thing standing between a URL and
someone else's bill. `supabase/functions/gba-policy/` is the worked example.

## Locking one app to specific people

The hub's default access model is "the published URL plus sign-in is the gate",
and `schema-anon-restore.sql` widens that further: it grants the `anon` role
full CRUD on *all* of `app_data`, table-wide, because the seating board needs
it. The publishable key is committed and ships inside every bundle, so for any
app that holds something private, that key is not a boundary at all.

`schema-household.sql` is the worked example of making the boundary real for
one app without touching the others. Three parts worth reusing:

- **Membership is data**, in a small table with RLS on and no policies (plus an
  explicit `revoke`, since Supabase's default privileges on `public` decide
  whether a grant exists at all). The list is referenced by several policies,
  and an email list copied into several policies goes out of sync.
- **The policy is `as restrictive`.** A permissive policy adds access;
  restrictive subtracts it, ANDing with every other policy on the table. That
  is what makes it hold regardless of what else grants access now or later —
  the broad anon grant included — and scoping it `app <> '<name>' or …` is what
  keeps every other app's access exactly as it was.
- **The membership test needs `security definer`.** A policy's `USING` runs as
  the requesting user, so a plain subquery against the members table is subject
  to that table's own RLS, finds nothing, and denies everyone including you.

Attachments are a separate boundary and easy to miss: `hub-files` is a **public**
bucket, so a receipt in it is readable by anyone with the link, forever, signed
in or not. An app that locks its rows and leaves its files there has not locked
anything. Give it its own private bucket and ask for signed links:

```js
const db = store("<name>", { shared: true, bucket: "<name>-files", privateFiles: true });
const links = await db.fileUrls(paths, 8 * 3600);  // { path: signedUrl }, one request
```

Verify it rather than trusting it — a policy that quietly denies everyone looks
identical to one that works until the wrong person tries. `schema-household.sql`
ends with checks that run as `anon`, as a member and as a stranger; each is
wrapped in `begin … rollback` because **`SET LOCAL` outside a transaction is
ignored with only a warning**, and the query then runs as the table owner, who
bypasses RLS. That failure mode reports every private row as world-readable when
nothing is wrong.

## Conventions

- Keep apps small and dependency-light; reuse `shared/` rather than adding libs.
- Public Supabase values live in `shared/config.js` — the real security boundary
  is Postgres row-level security, not those strings.
- Mobile-first: `viewport-fit=cover`, `100dvh`, generous tap targets.
