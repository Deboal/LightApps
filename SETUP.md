# App Hub — Setup

One shared backend, one repo, one Netlify site. After four one-time steps, every new app is a
prompt: Claude adds a folder under `apps/`, commits, Netlify auto-deploys, and you get a URL. You
never run a provisioning script per app again.

## The four one-time steps

### 1. Shared backend (once, ever)
- Create a single Supabase project named e.g. `app-hub`.
- SQL Editor: paste and run `schema.sql`. That creates the generic `app_data` table, the shared
  `hub-files` bucket, the policies, and realtime.
- Settings > Data API: **Copy** the Project URL. Settings > API Keys: **Copy** the publishable key.
- Paste both into `shared/config.js`. These are public values, safe to commit.

### 2. The repo (once)
- Create a GitHub repo and push this folder to it.

### 3. Netlify (once)
- Netlify: Add new site, Import from Git, pick the repo. The build command (`bash build.sh`) and
  publish dir (`public`) come from `netlify.toml`, so just deploy. You get a hub URL.
- Each app lives at `<hub-url>/<app-name>/`. The root URL lists all apps.

### 4. Give Claude write access (once)
- Best: connect a GitHub connector in Claude, so access persists with no token-pasting.
- If no connector is available: create a **fine-grained GitHub token** scoped to **this one repo**
  with **contents: read and write**, and give it to Claude at the start of a building session.
  Rotate or delete it when done.

## Steady state: type a prompt, get an app

Once the four steps are done, building a new app is:

1. You: "Build a <thing> that does <X>."
2. Claude: adds `apps/<thing>/index.html` and `apps/<thing>/src/app.jsx` (using the shared `store`),
   commits, pushes.
3. Netlify auto-builds. Live at `<hub-url>/<thing>/` in ~30 seconds.

Iterating is the same loop: "make the buttons bigger" → Claude edits, commits → live shortly after.
No new Supabase project, no new keys, no manual deploy.

## How an app uses the backend

Every app gets a namespaced store with one line:

```js
import { store } from "../../../shared/store.js";
const db = store("my-app");          // namespaced to "my-app"

await db.set("items", { name: "x" }); // create
await db.list("items");               // read all -> [{id, ...}]
await db.set("items", {...it}, it.id);// update
await db.remove("items", it.id);      // delete
db.subscribe(reload);                 // realtime
await db.uploadFile(file);            // shared bucket, namespaced
```

`gear-tracker` is a working example of all of this in ~80 lines.

## Adding an app by hand (if ever needed)

1. `mkdir -p apps/<name>/src`
2. Add `apps/<name>/index.html` (copy gear-tracker's; change the title) and
   `apps/<name>/src/app.jsx` (import the shared store, build the UI).
3. Commit and push. `build.sh` bundles it and Netlify serves it at `/<name>/`.

## Local preview

```bash
bash build.sh         # bundles every app into public/
npx serve public      # or any static server
```

## Honest tradeoffs

- All apps share one key, so any app's key could read any app's data. Fine for low-stakes internal
  tools. If one app ever holds something sensitive, give that app its own Supabase project and the
  lightweight-app-builder skill's standalone pattern instead.
- The default access model is "the URL is the credential." For real per-user access, add Supabase
  Auth and tighten the policies (the lightweight-app-builder skill documents the v2 path).
