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

### 1b. GBA cloud saves (only if you use the GBA app)

- SQL Editor: paste and run `schema-gba.sql`. That creates a **private** `gba`
  storage bucket scoped to each user's own folder, and a trigger that refuses a
  save whose version does not advance.
- This is separate from `hub-files` on purpose: that bucket is public-read and
  shared across every signed-in hub user, which is fine for trip photos and
  wrong for cartridges and save files.

### 1c. GBA prompt-driven play (only if you want it)

This is what lets you type "grind experience for Pikachu" and walk away. The
model is asked **once**, for a small object saying what to do; the emulator then
runs that object on its own at eight times speed with nothing on the network.
One short request per prompt — not one per frame — which is why it costs cents
rather than dollars an hour.

The Anthropic key lives on the server and never reaches a browser. The app is a
static page: anything it holds, anyone who opens it holds too.

1. **Get a key.** console.anthropic.com > API keys > Create key. Copy it; you
   cannot read it again afterwards.
2. **Store it as a secret.** Supabase dashboard > Edge Functions > Secrets >
   Add new secret. Name it exactly `ANTHROPIC_API_KEY`, paste the key, save.
   Secrets are project-wide, so this only has to be done once.
3. **Deploy the function.** Dashboard > Edge Functions > Deploy a new function
   > *via editor*. Name it exactly `gba-policy`, paste the whole contents of
   `supabase/functions/gba-policy/index.ts`, and deploy.

   With the Supabase CLI instead:
   ```sh
   supabase functions deploy gba-policy --project-ref <your-project-ref>
   ```
4. **Leave "Verify JWT" on.** It is the default, and it is what stops anyone
   who finds the URL from spending your credits: without it the function is an
   open door to your key.

If the app reports that no key is set, the function is deployed but step 2 was
missed or the secret is spelled differently — the name must match exactly. A
secret added after a deploy is picked up without redeploying.

**What it costs.** One request per prompt, a few hundred tokens in and well
under a hundred out. At Opus 5 rates that is a fraction of a cent per prompt.
The run itself is free: nothing touches the network once it starts.

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
