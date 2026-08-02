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

## Google Drive + GitHub integration (chat attachments, project creation)

This now piggybacks on the same "Continue with Google" / "Continue with
GitHub" sign-in you already have — no separate OAuth app, no client
ID/secret, no extra buttons. Signing in (or connecting/re-linking an
account from `/account`) with Google also grants Drive access; doing the
same with GitHub also grants repo access. That's implemented in
`lib/firebase.js` (the added scopes) and `lib/integrations.js`
(`saveGoogleCredential` / `saveGithubCredential`, called right after
`signInWithPopup`/`linkWithPopup` resolves).

There's still one real setup step, and one real limitation:

- **Google Cloud setup (one-time):** the `drive.file` scope has to be
  enabled on the Google Cloud project behind your Firebase project (find it
  in [console.cloud.google.com](https://console.cloud.google.com/), same
  project as `blueprint-drs`). Go to **APIs & Services → Library** and
  enable the **Google Drive API**, then **APIs & Services → OAuth consent
  screen** and add the scope `.../auth/drive.file`. If the consent screen
  is in "Testing" mode, also add your own Google account under **Test
  users**, or the whole sign-in will be blocked. GitHub needs nothing
  extra — whatever OAuth App you already set up for "Continue with GitHub"
  in Firebase console just gets asked for the `repo` scope now too.
- **Drive tokens expire in ~1hr, with no silent refresh.** Firebase's
  client SDK doesn't expose a refresh token for this flow, so once a
  Drive-backed action fails with "connection expired," the fix is
  re-signing in with Google (or clicking "Refresh Drive access" on
  `/account`) — there's no background renewal. GitHub tokens don't expire,
  so that one's set-and-forget.

Nothing breaks if you skip the Google Cloud step — the Drive-specific
buttons/toggles just won't do anything useful until it's done (Drive API
calls will fail with a permission error, surfaced in the UI).

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

Without this rule, saving the Drive/GitHub token after sign-in (or from
`/account`) will fail with `permission-denied`.

## Fonts

Down to exactly two: **Raleway** for the "Blueprint" wordmark only
(`.brand-wordmark` in `globals.css`), **DM Sans** for everything else. If you
add new UI, use `font-family: "DM Sans", sans-serif` (or inherit — the body
default is already DM Sans) and don't introduce a third typeface.
