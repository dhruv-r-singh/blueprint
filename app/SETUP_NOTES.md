# Setup notes

Your original `README.md` isn't in a folder I have write access to this
session, so these notes live here instead — fold them into the README
whenever convenient.

## Firebase Storage rules (project images, chat attachments, voice notes, profile pictures)

Your `firebaseConfig` already has a `storageBucket`, so Storage itself is
provisioned — but it has its own separate rules from Firestore
(`storage.rules`, not `firestore.rules`). Set these in Firebase console →
**Storage → Rules**:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /profiles/{uid}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /projects/{projectId}/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

The `projects/{projectId}` rule is intentionally simple (any signed-in user,
not just members) to match this app's existing posture — Firestore's own
`projects` rule already lets any signed-in user *read* a project, so this
isn't loosening anything that wasn't already loose. Tighten it to check
project membership (mirroring the Firestore rules) if you want stricter
isolation between projects.

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

## Shared project Calendar

Each project has a **Calendar** tab (`projects/{id}/events` subcollection).
Creating an event does two things: saves it to Firestore so every member
sees it in-app immediately, and — if the creator has Google connected —
also creates a real Google Calendar event on the creator's calendar and
invites every other member **by email** (`lib/integrations.js`'s
`createCalendarEvent`). Unlike the GitHub repo invite, this doesn't need
the invitee's own token — Google Calendar invites are just email, so it
works for teammates whether or not they've connected Google themselves.

Two things needed for this to fully work:

- **Calendar API scope:** `googleProvider` in `lib/firebase.js` now also
  requests `.../auth/calendar.events`. In Google Cloud Console, enable the
  **Google Calendar API** (same place as the Drive API step above) and add
  its scope to the OAuth consent screen too.
- **Member emails:** invites go out to whatever's on each member's public
  `profiles/{uid}.email` field, which gets set automatically the next time
  they sign in (any provider) — see `savePublicIdentity` in
  `lib/integrations.js`. Members who haven't signed in since this shipped
  won't have an email on file yet, so they'll just be missing from the
  Google invite (still see the event in-app, though) until they next log in.

If the creator's Google connection is missing/expired, the event still
saves to Firestore for everyone — the UI just shows a note that the Google
Calendar invite step was skipped, instead of failing the whole thing.

## Activities (whiteboard + retro board)

New **Activities** tab with two sub-views, both plain Firestore (no
Storage, no external API):

- **Whiteboard** — freehand drawing on a shared canvas
  (`projects/{id}/whiteboard`, one doc per completed pen stroke: a list of
  points, a color, a width). Strokes sync once you lift the pen, not
  continuously mid-stroke, to keep write volume sane — still feels
  real-time in practice since strokes are short. "Clear board" deletes
  every stroke doc; there's no undo once cleared.
- **Retro board** — three columns (Went well / To improve / Action items),
  `projects/{id}/retro`, one doc per sticky note. Anyone can add a note to
  any column; only the author can remove their own note.

Both ride on the same open subcollection pattern tasks/messages/events
already use, so no extra Firestore rule is needed if those already work.

## 3D CAD viewer

Any local file attached in chat (task 18's "Upload from your computer") that
ends in `.stl`, `.obj`, `.gltf`, or `.glb` gets a "View in 3D" button next
to it — opens `app/components/CADViewer.js`, an orbit-controllable Three.js
viewer.

One thing worth knowing: this repo's `package.json` wasn't in any folder I
had write access to this session, so instead of adding `three` as an npm
dependency, `CADViewer.js` loads the same Three.js build (and its
STL/OBJ/GLTF loaders + OrbitControls) straight from jsdelivr at runtime, the
first time someone opens a 3D preview. It works with zero setup, but it
does mean that feature specifically needs the visitor to have internet
access to `cdn.jsdelivr.net` — everything else in the app still works
offline-from-CDNs. If you'd rather bundle Three.js properly, `npm install
three` and swap the dynamic `<script>` loading in `CADViewer.js` for normal
`import * as THREE from "three"` / `three/examples/jsm/...` imports.

### New members automatically getting access

- **Drive folder:** at creation time, the folder is set to "anyone with the
  link can edit" (`lib/integrations.js`'s `createDriveFolder`). There's no
  per-user Drive invite happening — every member (current and future) gets
  access just by having the link, which is already shown on the project's
  Overview tab to anyone who's a member. Trade-off: anyone who gets the
  link can edit it, member or not — don't put anything sensitive in a
  project Drive folder.
- **GitHub repo:** this one *is* a real per-user invite
  (`inviteGithubCollaborator`), because private GitHub repos don't have a
  link-sharing option — only someone with admin rights on the repo (the
  owner) can grant access, and that requires the owner's own token. Since
  no other user's browser can read the owner's token (see the Firestore
  rule above), the owner's own client does this itself: whenever the
  project owner has the project open, it checks `project.memberIds`
  against `project.githubInvited` and sends a real GitHub collaborator
  invite (which the invitee still has to accept) to anyone new — as long
  as that member has connected GitHub themselves, so the app knows their
  GitHub username (stored on their public `profiles/{uid}.githubUsername`
  when they connect). Practically: it's automatic, but only happens the
  next time the *owner* is in the app, not instantly the moment someone
  joins, and it needs the joining member to have connected GitHub too.

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

## Online/offline presence

Shows a green/gray dot on teammates' avatars in a project's Team panel
(Overview tab) and in chat. There's no Realtime Database in this project
(only Firestore, which has no built-in disconnect detection), so this uses
the standard workaround instead: `lib/presence.js` writes a heartbeat
timestamp to the signed-in user's own `profiles/{uid}.lastActiveAt` every
25s while the app is open (started from `TopNav.js`, which mounts on every
signed-in page), and anyone updated in the last 45s is shown as online.

Trade-offs worth knowing: closing the tab doesn't mark you offline
instantly — it just stops the heartbeat, so you'll show online for up to
~45s after you've actually left. And this adds a small steady stream of
Firestore writes (one per active user every 25s) — fine at this app's
scale, but worth knowing if you're watching Firestore usage/billing
closely later.

## Two-factor authentication (phone + authenticator app)

`/account` now has a "Two-factor authentication" section (`lib/mfa.js`,
`app/components/MfaChallenge.js`) letting a signed-in user add a phone
number (SMS codes) and/or an authenticator app (TOTP — Google
Authenticator, Authy, 1Password, etc.) as a second factor. Once either is
enrolled, **every future sign-in** — including Google/GitHub/LinkedIn,
not just email/password — pauses after the identity-provider step and
demands the second factor. That challenge screen (`MfaChallenge.js`) is
wired into both sign-in entry points, `/` and `/join/[code]`.

This is the most environment-sensitive feature added tonight — a few
things to check if it doesn't work out of the box:

- **Multi-factor auth has to be turned on for the project first.** Firebase
  console → Authentication → Sign-in method → Advanced → enable
  multi-factor authentication (SMS and/or TOTP). On some projects this
  requires upgrading from the Spark (free) plan to Blaze (pay-as-you-go),
  since SMS delivery costs money — TOTP itself is free, but the
  multi-factor *feature* may still gate on the plan.
- **TOTP needs a reasonably recent Firebase JS SDK** (10.9.0+,
  `TotpMultiFactorGenerator` wasn't added before that). `lib/mfa.js`
  feature-detects this and throws a clear "needs a newer Firebase SDK"
  message instead of crashing if it's missing — if you see that message,
  bump the `firebase` package version. SMS-based 2FA doesn't have this
  requirement.
- **`RecaptchaVerifier`'s constructor signature changed between Firebase
  SDK major versions.** This code uses the modular v10+ shape —
  `new RecaptchaVerifier(auth, containerId, params)`. If your installed
  version is older and expects `(containerId, params, auth)` instead,
  you'll see a type error the moment phone enrollment/sign-in tries to
  send a code — swap the argument order in `lib/mfa.js`'s
  `getRecaptchaVerifier` and `MfaChallenge.js` to match.
- **Enrolling can fail with "requires-recent-login"** if your sign-in
  session is old. The UI surfaces this as a message pointing back to
  "Connected accounts" above — reconnect a provider there (which
  re-authenticates you), then try enrolling again.

## Fonts

Down to exactly two: **Raleway** for the "Blueprint" wordmark only
(`.brand-wordmark` in `globals.css`), **DM Sans** for everything else. If you
add new UI, use `font-family: "DM Sans", sans-serif` (or inherit — the body
default is already DM Sans) and don't introduce a third typeface.
