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

## Offline single-file export (for self-contained apps)

For an app with no backend, you can hand the user one file that runs offline
(great for spotty signal). After `bash build.sh`, inline `public/<name>/bundle.js`
into a `<script>` in a copy of the app's `index.html` — one self-contained
`.html` the user can save to their phone and "Add to Home Screen." Verify it by
loading it as a `file://` URL with all network requests blocked.

## Conventions

- Keep apps small and dependency-light; reuse `shared/` rather than adding libs.
- Public Supabase values live in `shared/config.js` — the real security boundary
  is Postgres row-level security, not those strings.
- Mobile-first: `viewport-fit=cover`, `100dvh`, generous tap targets.
