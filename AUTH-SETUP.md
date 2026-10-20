# Adding sign-in to the hub (email magic link)

Order matters so the live site never breaks. You do steps 1 and 2, I deploy the code in step 3,
then we test, then you lock it down. Between each step the site stays working.

## 1. Supabase dashboard (yours, one-time)
- **Authentication > Providers > Email:** confirm Email is enabled (it is by default). This covers
  magic links; no password setup.
- **Authentication > URL Configuration:**
  - **Site URL:** `https://lightappsad.netlify.app`
  - **Redirect URLs:** add `https://lightappsad.netlify.app/**` (the `/**` lets every app path
    receive the sign-in link).
- **Email note:** Supabase's built-in email is rate-limited (a few per hour), fine for you plus a
  couple of testers. For real volume, configure SMTP later under Authentication > Emails. Not
  needed to start.

## 2. Run the migration (yours)
SQL Editor, paste and run **schema-auth.sql**. It adds `owner` and `visibility` and the
authenticated access rules, and deliberately keeps the existing anonymous rules, so nothing breaks
between now and the code deploy.

## 3. Deploy the code (mine)
Once 1 and 2 are done, tell me and I commit the auth-enabled code. Netlify auto-deploys and the
apps start requiring sign-in. The authenticated rules from step 2 are already live, so there's no
broken window.

## 4. Test
Open the gear-tracker, enter your email, click the link in your inbox, and you land back signed in.
Add an item; it's private to you. Sign in with a different email on another device and you'll see a
separate, empty list. That's distinct users, working.

## 5. Lock it down (yours)
After sign-in works, SQL Editor, run **schema-auth-enforce.sql** to remove anonymous access. Now
every app requires sign-in.

## How apps use it (for future builds)
- **Private (default):** `store("my-app")` gives each user only their own data.
- **Shared:** `store("my-app", { shared: true })` lets all signed-in users share the data (e.g. the
  Ecuador ledger), with each row recording who wrote it.
- **Gate:** wrap the app root in `<AuthGate>{(user) => <App user={user} />}</AuthGate>`.

## Password sign-in (household)
`<AuthGate method="password">` swaps the magic link for email + password. The household ledger
uses it because magic links kept failing there: a corporate mail scanner (Outlook Safe Links)
opens the link before you do and spends the one-time token, and a home-screen web app on iOS
keeps its own storage, so the link signs in Safari instead of the app. There is no sign-up
screen; accounts are made here, once.

The Email provider already covers passwords; nothing to enable. Then, per person:

- **No account yet:** Authentication > Users > Add user > Create new user. Enter the email and a
  password, tick **Auto Confirm User**.
- **Account already exists** (any earlier magic-link attempt created one, so this is the usual
  case): SQL Editor, with the real password in place of the placeholder:
  ```sql
  update auth.users
     set encrypted_password = extensions.crypt('PASSWORD-HERE', extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now())
   where lower(email) = lower('someone@example.com');
  ```
  `UPDATE 1` means done; `UPDATE 0` means no account, so use Add user instead. The SQL Editor
  keeps query history, so clear the snippet afterwards or change the password once signed in.

The sign-in email must also be in `household_members` (see `schema-household.sql`). If it isn't,
the app now says so instead of showing an empty ledger.
