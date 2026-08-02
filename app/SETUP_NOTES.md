# Setup notes

Your original `README.md` isn't in a folder I have write access to this
session, so these notes live here instead — fold them into the README
whenever convenient.

## LinkedIn sign-in

LinkedIn sign-in is not a built-in Firebase provider — it's a **custom OIDC
provider** you wire up by hand. This is almost always why it's failing.

1. In the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps),
   open your app, go to **Products**, and add **"Sign In with LinkedIn using
   OpenID Connect."**
2. Under **Auth**, add this exact redirect URL:
   `https://blueprint-drs.firebaseapp.com/__/auth/handler`
   (Firebase handles the callback itself — this is the only redirect URI
   LinkedIn needs, whether sign-in happens via popup or redirect.)
3. Copy the **Client ID** and **Client Secret** LinkedIn gives you.
4. In Firebase console → **Authentication → Sign-in method → Add new
   provider → OpenID Connect**, create a provider with:
   - Provider ID: `oidc.linkedin` (must match exactly — this is what
     `lib/firebase.js` references)
   - Client ID / Client secret: from step 3
   - Issuer URL: `https://www.linkedin.com/oauth`
5. Save, then try signing in again.

If it still fails, the error banner on the sign-in page (and on
`/account`) now shows a specific reason instead of a raw error code:

- **"this sign-in method isn't turned on yet"** → you skipped/missed step 4
- **"this domain isn't in Firebase's authorized domains list"** → add your
  `*.vercel.app` URL (or custom domain) under Authentication → Settings →
  Authorized domains
- **"the identity provider rejected the request"** → double check the
  client ID/secret and issuer URL in step 4 for typos
- **"the browser blocked the sign-in popup"** → allow popups for the site

## Firestore rules — invite links now need one more rule

Project invites (`/join/[code]`) work by looking up a project via its
`inviteCode` field, then adding the signed-in user's uid to `memberIds`. The
existing rule only lets *current* members update a project, so joining via
invite will fail with `permission-denied` until you add this. In Firebase
console → **Firestore → Rules**, inside `match /projects/{projectId} { ... }`,
add:

```
// Let a signed-in non-member join by adding *only* their own uid to
// memberIds — everything else on the document must stay untouched.
allow update: if request.auth != null
  && !(request.auth.uid in resource.data.memberIds)
  && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['memberIds'])
  && request.resource.data.memberIds == resource.data.memberIds.concat([request.auth.uid]);
```

This sits alongside (not instead of) the existing
`allow update, delete: if request.auth != null && request.auth.uid in resource.data.memberIds;`
rule — Firestore rules are additive, so both can be true.

## Google Drive + GitHub integration (chat attachments)

This needs OAuth app credentials you create yourself — I can't generate
these. Nothing breaks if you skip this section; the "Connect" buttons on
`/account` just stay disabled and chat attachments fall back to pasting a
raw link.

### Google Drive

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or
   reuse) a project, then **APIs & Services → Library** → enable the
   **Google Drive API**.
2. **APIs & Services → OAuth consent screen**: set it up (External is fine
   for testing), add the scope `.../auth/drive.file`, and add your own
   Google account under **Test users** if the app is in "Testing" mode
   (otherwise sign-in will be blocked).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**,
   type **Web application**. Add these to **Authorized redirect URIs**:
   - `http://localhost:3000/account` (local dev)
   - `https://blueprint-app-dhruv-raj-singh-s-projects.vercel.app/account`
     (production — from `electron/main.js`'s `APP_URL`; swap in your actual
     domain if that's changed)
4. Copy the **Client ID** and **Client secret**, and set these environment
   variables (Vercel → Settings → Environment Variables, and `.env.local`
   for dev):
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

### GitHub

1. [GitHub Developer Settings](https://github.com/settings/developers) →
   **OAuth Apps → New OAuth App**.
2. Homepage URL: your app's URL. **Authorization callback URL**:
   - `http://localhost:3000/account` (local dev — you'll need a second
     OAuth App, or just swap this value while developing, since GitHub
     OAuth Apps only support one callback URL each)
   - `https://blueprint-app-dhruv-raj-singh-s-projects.vercel.app/account`
     (production)
3. Copy the **Client ID**, generate a **Client secret**, and set:
   - `NEXT_PUBLIC_GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`

### Firestore rule — lock down the token storage

Tokens are stored at `profiles/{uid}/private/integrations`, deliberately
**not** on the `profiles/{uid}` document itself — that doc is readable by
any signed-in user (on purpose, so profiles are discoverable for matching),
which would otherwise leak access tokens to every other user. Add this rule
so only the owner can read/write it:

```
match /profiles/{uid} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && request.auth.uid == uid;

  match /private/{doc} {
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
}
```

Without this rule, the "Connect Google Drive"/"Connect GitHub" writes in
`/account` will fail with `permission-denied`.

## Fonts

Down to exactly two: **Raleway** for the "Blueprint" wordmark only
(`.brand-wordmark` in `globals.css`), **DM Sans** for everything else. If you
add new UI, use `font-family: "DM Sans", sans-serif` (or inherit — the body
default is already DM Sans) and don't introduce a third typeface.
