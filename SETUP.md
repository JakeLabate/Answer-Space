# Accounts — setup

Everything here is already provisioned except **one secret you must paste in
yourself**. Until you do, sign-up and sign-in work and history is saved; only the
storing of vendor API keys on the account is refused, with a clear error.

| Thing | Value |
|---|---|
| Supabase project | `answer-space` (`uzfshuoycqgavcelfnbv`) |
| API URL | `https://uzfshuoycqgavcelfnbv.supabase.co` |
| Publishable key | `sb_publishable_BF5cjzwr6syRL2EK8MKP1w_8GYLziJc` |
| Region / cost | `us-east-1` · $0/month (free tier) |

Both values in `config.js` are public by design. The publishable key identifies
the project, it does not grant access — every table is behind row-level security
keyed to `auth.uid()`.

---

## 1. The one required step

Set the master key the Edge Function uses to encrypt vendor API keys.

Generate one — any base64 string that decodes to exactly 32 bytes:

```sh
openssl rand -base64 32
```

**Dashboard → Project Settings → Edge Functions → Secrets → Add new secret**

```
Name:  KEY_ENCRYPTION_SECRET
Value: <the output of the command above>
```

> The real value is deliberately **not** written down in this repo. It is the one
> secret here that must never be committed — this is a public repository, and a
> master key in public is a master key that is gone.

> **Do not lose it and do not rotate it casually.** It is the only thing that can
> decrypt what is in `public.api_keys`. Changing it does not break sign-in or
> history; it makes existing stored keys undecryptable, and users simply re-enter
> them. There is no copy anywhere else — not in the database, not in this repo.

Verify it took:

```sh
curl -s -X POST https://uzfshuoycqgavcelfnbv.supabase.co/functions/v1/keys \
  -H "apikey: sb_publishable_BF5cjzwr6syRL2EK8MKP1w_8GYLziJc" \
  -H "authorization: Bearer <a-signed-in-users-access-token>" \
  -H "content-type: application/json" \
  -d '{"action":"list"}'
```

`{"keys":[]}` means it is working. `KEY_ENCRYPTION_SECRET is not set on this
function` means it is not.

---

## 2. Email confirmation

New projects require users to confirm their email, and the built-in mailer is
capped at a few messages per hour — fine for you, not for real signups. Pick one:

- **Leave it on** and add SMTP under *Authentication → Emails → SMTP Settings*.
  This is the right answer if strangers will sign up.
- **Turn it off** under *Authentication → Sign In / Providers → Email →
  "Confirm email"* for a frictionless start. Accounts then work the instant
  someone submits the form.

The dashboard handles both: with confirmation on, sign-up says *"Check your email
to confirm the address, then sign in."* rather than pretending it worked.

## 3. Redirect URLs

For the *Forgot password* link to return people to the right place, add wherever
you host the dashboard under **Authentication → URL Configuration → Redirect
URLs**, for example:

```
http://localhost:8080/**
https://<you>.github.io/<repo>/**
```

---

## Deploying

Accounts do **not** cost you the static-hosting story. Supabase is a separate
service the browser talks to directly, so GitHub Pages still works exactly as
described in the README — `index.html` and its assets, no build step, no server
of yours. Netlify, Vercel or any static host are equally fine.

## Turning accounts off

Blank the URL in `config.js`:

```js
window.ANSWER_SPACE_CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };
```

The account button disappears and the dashboard is the original zero-backend
tool again — localStorage, IndexedDB, nothing else. Nothing else needs changing.

## Applying the schema elsewhere

`supabase/migrations/20260825000000_init.sql` is the whole schema and is already
applied to the project above. For a fresh project, run it in the SQL editor, then
deploy the function:

```sh
supabase functions deploy keys --project-ref <ref>
supabase secrets set KEY_ENCRYPTION_SECRET="$(openssl rand -base64 32)" --project-ref <ref>
```

---

## What is stored, and where

| Data | Signed out | Signed in |
|---|---|---|
| Profile, query set, ground truth, scan settings | `localStorage` | `localStorage` **and** `public.workspaces` |
| Vendor API keys | `localStorage`, plaintext | `public.api_keys`, AES-256-GCM — **not** in `localStorage` |
| Raw answers, extractions, verifications | IndexedDB | IndexedDB **and** `public.snapshots.raw` |
| Built bundle | IndexedDB | derived on load, never stored server-side |

Local is always written first and the cloud second, so a failed sync cannot cost
you a run.

### The honest limit on key custody

The browser is the engine — it calls Anthropic and the rest directly — so it
needs the plaintext keys and this cannot be a write-only vault. What the design
buys is that a **database** leak yields nothing usable: ciphertext lives in
Postgres, the master key lives only in the Edge Function environment.

Whoever controls that environment can decrypt. On your own deployment that is
you. It is strictly better than plaintext at rest, and strictly weaker than a
client-side passphrase the server never sees — which was the alternative, and
which costs the cross-device sync that was the point of accounts.

If you would rather have that trade the other way, the change is contained: derive
a key from the user's password with PBKDF2 in `cloud.js`, encrypt before upload,
and drop the `keys` function entirely. Users then re-enter a passphrase on every
new device, and a forgotten password loses the stored keys.
