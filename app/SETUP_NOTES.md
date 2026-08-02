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

There's still one real setup step:

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

Nothing breaks if you skip the Google Cloud step — the Drive-specific
buttons/toggles just won't do anything useful until it's done (Drive API
calls will fail with a permission error, surfaced in the UI).

### Drive/Calendar tokens now refresh themselves — three more setup steps

The Google popup Firebase's own client SDK does never hands back a refresh
token, so a Drive/Calendar connection made *only* that way is only good for
about an hour, and previously just failed with "permission-denied" once it
lapsed (with no way to silently recover — this is the bug behind the
"Refreshing Google failed" error). That's fixed now with a real
refresh-token flow, but it needs three things you'll have to set up by hand
— I don't have access to your Google Cloud console, Vercel project, or
Firebase console to do this myself:

1. **A second, separate OAuth 2.0 Client ID.** Firebase's built-in Google
   sign-in doesn't let you request `access_type=offline` yourself, so this
   uses Google Identity Services directly, alongside (not instead of)
   Firebase Auth. In
   [console.cloud.google.com](https://console.cloud.google.com/) → **APIs &
   Services → Credentials** (same GCP project as `blueprint-drs`) → **Create
   credentials → OAuth client ID → Web application**. Under **Authorized
   JavaScript origins**, add `https://blueprint-app-dhruv-raj-singh-s-projects.vercel.app`
   (and any custom domain). No redirect URI is needed — the code flow this
   uses runs in popup mode. Copy the **Client ID** and **Client secret**.
2. **A Firebase service account key**, so the server can verify who's
   asking and store/read the refresh token safely (bypassing Firestore
   rules entirely, so this token is never exposed to any client-side rule).
   Firebase console → **Project settings → Service accounts → Generate new
   private key**. This downloads a JSON file — you'll paste its *entire
   contents* as a single-line env var.
3. **Three environment variables in Vercel** (Project Settings →
   Environment Variables):
   - `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` — the Client ID from step 1 (safe
     to expose to the browser — it's public by design).
   - `GOOGLE_OAUTH_CLIENT_SECRET` — the Client secret from step 1
     (server-only, do not prefix with `NEXT_PUBLIC_`).
   - `FIREBASE_SERVICE_ACCOUNT_KEY` — the full JSON from step 2, minified to
     one line (e.g. `cat key.json | jq -c .` or just strip the newlines).
4. **One new npm dependency**: `firebase-admin`. This repo's `package.json`
   wasn't in a folder I had write access to this session, so I couldn't add
   it myself — run `npm install firebase-admin` in the actual project
   before deploying (`lib/firebaseAdmin.js` imports it).

Until all four are in place, Drive/Calendar access silently falls back to
the old behavior (Firebase's ~1hr token, with "connection expired" once it
lapses) — nothing breaks, the new code just no-ops. Once they're set,
`connectGoogleOffline` in `lib/integrations.js` runs automatically right
after every Google sign-in (and also whenever "Connect"/"Refresh Drive
access" is clicked on `/account`), and `ensureFreshGoogleToken` silently
renews the token from then on — no more popups, no more "refresh" step.

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

### Firebase Storage needs CORS enabled, or every format but images/video will fail to preview

Chat attachments render fine as `<img>`/`<video>` tags no matter what, because
the browser is allowed to *display* a cross-origin file without needing
permission from the server. But every 3D loader here (STL/OBJ/FBX/3MF, plus
the STEP path) has to actually read the file's raw bytes into JavaScript via
`fetch()`, and that's a different, stricter browser rule: the response has to
carry an `Access-Control-Allow-Origin` header naming this app's origin, or
the browser blocks JS from ever seeing the bytes at all — it still downloads
fine, just silently, with the fetch throwing a plain "Failed to fetch" that
looks identical to a bad file. Firebase Storage buckets don't send that
header by default, so until this is set up, **every non-image/video 3D
upload will fail to preview**, no matter how valid the file is.

This is a one-time setting on the bucket, not something fixable from the
app's own code, and it has to be done via `gsutil` — but Google Cloud
Console's **Cloud Shell** is a terminal in the browser, so no local install
is needed:

1. Go to [console.cloud.google.com](https://console.cloud.google.com), pick
   this Firebase project from the project switcher (top left).
2. Click the **Cloud Shell** icon (`>_`) in the top right toolbar. It opens a
   terminal at the bottom of the page, already signed in and already scoped
   to this project.
3. In that terminal, create a file with:
   ```
   cat > cors.json << 'EOF'
   [
     {
       "origin": ["*"],
       "method": ["GET", "HEAD"],
       "maxAgeSeconds": 3600,
       "responseHeader": ["Content-Type"]
     }
   ]
   EOF
   ```
   (`"origin": ["*"]` is the simplest option and fine here since these are
   already-public download URLs with an unguessable token in them — swap it
   for `["https://blueprint-drs.web.app", "https://dhruvrsingh.com"]` etc. if
   you'd rather restrict it to known domains.)
4. Run:
   ```
   gsutil cors set cors.json gs://YOUR-BUCKET-NAME.appspot.com
   ```
   The bucket name is the same one shown in Firebase Console → Storage (top
   of the Files tab, looks like `blueprint-drs.appspot.com` or
   `blueprint-drs.firebasestorage.app` depending on when the project was
   created — use exactly what's shown there).
5. Confirm it took: `gsutil cors get gs://YOUR-BUCKET-NAME.appspot.com`
   should print the JSON back.

No redeploy needed — this takes effect immediately for every file already in
the bucket, old and new.

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
`/account`) will fail with `permission-denied`. This is almost certainly why
you're seeing (or saw) file uploads and Google/GitHub connects fail —
apply the rule above if you haven't yet.

Note: the newer refresh-token storage (`profiles/{uid}/private/google`, see
the "Drive/Calendar tokens now refresh themselves" section above) does
**not** need this rule or any client-facing rule at all — only the server
(via the Firebase Admin SDK in `lib/firebaseAdmin.js`) ever touches that
document, and the Admin SDK bypasses Firestore rules entirely.

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

## Delete project

Project Settings → Danger zone now has "Delete project" next to "Leave
project," visible only to the project owner in the UI. It removes every
doc in the project's subcollections (tasks, messages, events, whiteboard,
retro) before deleting the project doc itself — Firestore doesn't
cascade-delete subcollections automatically, so this does it manually,
client-side.

Worth knowing: the existing Firestore rule (`allow update, delete: if
request.auth.uid in resource.data.memberIds`) technically lets *any*
member delete a project via a direct API call, not just the owner — the
UI just hides the button from non-owners. If you want that actually locked
to the owner, tighten the rule to
`request.auth.uid == resource.data.ownerId` for the delete case
specifically.

## Message translation

Every text chat message now has a small "Translate" link under it
(`app/api/translate/route.js`, called from the chat message list in
`app/project/[id]/page.js`). It's on-demand and per-viewer — nothing gets
stored or broadcast, it just translates and shows the result inline for
whoever clicked it, targeting their browser's language.

Uses **`@vitalets/google-translate-api`** (`npm install
@vitalets/google-translate-api` — another dependency I couldn't add myself
since this repo's `package.json` isn't in a folder I had write access to).
No API key, no GCP billing, no setup step at all — it works the moment the
package is installed. The trade-off, straight from that library's own
README: it's an unofficial library that calls the same free endpoint
translate.google.com itself uses, not Google's paid, officially-supported
Cloud Translation API. Google rate-limits it per IP address (a 429
"TooManyRequestsError"), and on a serverless host like Vercel that IP is
shared across other tenants, so it's more likely to get rate-limited than
if it were running on a dedicated server. If translations start failing
under real usage, that's almost certainly why — the library supports
routing requests through a proxy to work around it (see its README's
"Limits" section), or you can swap to the official paid Cloud Translation
API instead for guaranteed uptime (needs a `GOOGLE_TRANSLATE_API_KEY` env
var and a small change to `app/api/translate/route.js` — ask me if you
want that swapped back in).

## Focus modes

The topbar has a status/focus picker next to the avatar (`app/components/
FocusMode.js`) — Available, Focusing, In a meeting, Away — Slack-style.
Saved to `profiles/{uid}.focusMode`, shown next to your name in a
project's Overview → Team panel too (skipped for "Available", the default,
to avoid clutter — only non-default statuses show a badge). Not yet wired
into every other place a teammate's name appears (e.g. chat messages) —
extending it there would just mean reading the same `focusModeInfo()`
helper (`app/components/FocusMode.js`) off `memberProfiles[uid].focusMode`.
It's purely informational for now, like Slack's status — doesn't mute
notifications or change behavior elsewhere while "Focusing."

## Hosting at a custom domain (blueprint.dhruvrsingh.com)

A subdomain is actually simpler than the earlier `dhruvrsingh.com/blueprint`
subpath plan — no `basePath` in `next.config.js`, no rewrite rules, nothing
in the app's own code changes at all. It's purely DNS plus two allowlists:

1. **Vercel:** project → **Settings → Domains → Add** → type
   `blueprint.dhruvrsingh.com` → Add. Vercel shows you a DNS record to
   create (usually a CNAME pointing `blueprint` at `cname.vercel-dns.com`,
   but use exactly what Vercel shows you).
2. **DNS:** go to wherever `dhruvrsingh.com`'s DNS is managed (your
   registrar, or Cloudflare/etc. if you moved it there) and add that
   CNAME record. Propagation is usually minutes, sometimes a couple hours.
   Vercel auto-issues the SSL certificate once it sees the record.
3. **Firebase console → Authentication → Settings → Authorized domains →
   Add domain** → `blueprint.dhruvrsingh.com`. Without this, Google/GitHub/
   LinkedIn sign-in popups will fail on the new domain with a "this domain
   isn't authorized" error.
4. **Google Cloud console → APIs & Services → Credentials** → open the
   second OAuth 2.0 Client ID (the one from "Drive/Calendar tokens now
   refresh themselves" above, not Firebase's own) → **Authorized JavaScript
   origins** → add `https://blueprint.dhruvrsingh.com`. This is the one
   that's easy to forget since it's a separate client from Firebase Auth's
   — Drive/Calendar connect would fail silently on the new domain without it.

Nothing about Firebase's own `authDomain` changes — sign-in popups always
route through `blueprint-drs.firebaseapp.com` no matter what domain the app
itself is hosted at, so steps 3 and 4 above are the only auth-related
changes a new domain ever needs.

## Removing the Google sign-in "testing" restriction

If only your own Google account can sign in and everyone else gets blocked
or never sees the popup complete, that's the OAuth consent screen sitting in
**Testing** mode — Google caps that at a manually-added allowlist of up to
100 test users, which is meant for development, not real usage.

1. [console.cloud.google.com](https://console.cloud.google.com) → same GCP
   project as `blueprint-drs` → **APIs & Services → OAuth consent screen**.
2. Next to the **Testing** status badge near the top, click **PUBLISH APP**,
   then confirm. That's it — the test-user allowlist no longer applies, and
   anyone with a Google account can sign in.

One thing to expect afterward, not a blocker: this app requests Drive and
Calendar scopes, which Google treats as "sensitive." Until the app goes
through Google's formal verification review, new users will see a "Google
hasn't verified this app" interstitial during sign-in, with an "Advanced →
Go to Blueprint (unsafe)" link to click through — sign-in still completes
fine, it's just an extra click. Verification (to make that warning go away
entirely) needs a privacy policy URL and terms of service URL added to the
consent screen, then a submission for review, which Google can take
anywhere from a few days to a few weeks to process — worth doing eventually
for a real launch, not needed just to let people sign up.

## Fonts

Down to exactly two: **Raleway** for the "Blueprint" wordmark only
(`.brand-wordmark` in `globals.css`), **DM Sans** for everything else. If you
add new UI, use `font-family: "DM Sans", sans-serif` (or inherit — the body
default is already DM Sans) and don't introduce a third typeface.

## Message requests + mailbox

A "Message" button now shows up in two places — on each candidate card in a
project's Matches tab, and next to each teammate in the Team rail on the
Team chat tab. Both open the same compose modal
(`app/components/MessageRequestModal.js`): a subject + message, saved to a
new top-level `messageRequests` collection rather than dropping straight
into project chat, since the whole point is reaching someone you're not
already teammates with.

The bottom-right mailbox button (`app/components/Mailbox.js`, mounted once
in `TopNav.js` so it's on every signed-in page) shows a red badge for how
many of those are unread, and a panel to read them, for whoever's signed in.

One thing worth knowing: candidates on the Matches tab are the seed/demo
profiles from `SEED_CANDIDATES`, not real accounts — messaging one still
saves a real Firestore doc (so there's a record of the outreach), but with
`toUid: null`, so it can never show up in anyone's mailbox. There's no
account behind it to deliver to. Messaging an actual teammate from the Team
rail *does* have a real `toUid` and shows up in their mailbox for real —
that's the one to use to actually test the notification badge.

**New Firestore rule needed.** In Firebase console → **Firestore → Rules**,
add a new top-level match block (a sibling of `match /projects/{projectId}`,
not nested inside it):

```
match /messageRequests/{requestId} {
  // Anyone signed in can send one, but only as themselves.
  allow create: if request.auth != null
    && request.resource.data.fromUid == request.auth.uid;
  // Only the sender or the recipient can read a given request.
  allow read: if request.auth != null
    && (resource.data.toUid == request.auth.uid || resource.data.fromUid == request.auth.uid);
  // Only the recipient can update one, and only to flip `read` to true —
  // nothing else about the request is editable after it's sent.
  allow update: if request.auth != null
    && resource.data.toUid == request.auth.uid
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read']);
}
```

No reply feature yet — the mailbox is read-only for now (mark-as-read
happens automatically when you click a request open). If you want a reply
box added, it's a small follow-up: another field or subcollection plus a
form in `Mailbox.js`.
