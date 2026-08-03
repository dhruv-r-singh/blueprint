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

**LinkedIn sign-in does NOT use Firebase's built-in "OpenID Connect" sign-in
provider.** It used to try to, but that path is fundamentally broken:
Firebase's generic OIDC connector authenticates its token-exchange call to
the provider with an HTTP Basic Auth header, while LinkedIn's token
endpoint only accepts the client secret as a POST body parameter. Every
attempt fails with `INVALID_IDP_RESPONSE: ... "A required parameter
'client_secret' is missing"`, no matter how correctly the provider is
configured in the Firebase console. This is a real, documented
incompatibility between Firebase Auth and LinkedIn — not a setup mistake,
and there's no config value that fixes it.

Instead, LinkedIn sign-in is a **hand-rolled OAuth flow** — the same
approach used in Firebase's own official `linkedin-auth` Cloud Functions
sample — implemented as two API routes:

- `app/api/auth/linkedin/start/route.js` — redirects the browser to
  LinkedIn's authorization screen.
- `app/api/auth/linkedin/callback/route.js` — LinkedIn redirects back here
  with a `code`; this route exchanges it for an access token (client
  secret correctly sent in the POST body this time), fetches the user's
  profile from LinkedIn, creates/updates a Firebase user for them via the
  Admin SDK (uid `linkedin:<linkedin sub>`), and mints a Firebase **custom
  token**. It redirects back to whichever page started the flow
  (`/signin` or `/join/[code]`) with that token in the URL, which then
  calls `signInWithCustomToken`.

To set this up:

1. In the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps),
   open your app → **Products** → confirm **"Sign In with LinkedIn using
   OpenID Connect"** is already added (it should be — this hasn't changed).
2. Under **Auth → Authorized redirect URLs**, **add** (don't remove the
   existing Firebase one, it doesn't hurt anything left in place):
   `https://<your-domain>/api/auth/linkedin/callback`
   — e.g. `https://blueprint.dhruvrsingh.com/api/auth/linkedin/callback`.
   If you also test from a different domain (a Vercel preview URL, etc.),
   add that one too — LinkedIn allows multiple.
3. Copy the **Client ID** and **Primary Client Secret** from the Auth tab
   (same values already sitting in Firebase's OIDC provider config — you
   can copy them from there instead if that's easier).
4. In **Vercel → your project → Settings → Environment Variables**, add:
   - `LINKEDIN_CLIENT_ID`
   - `LINKEDIN_CLIENT_SECRET`
   Redeploy after adding these (env var changes need a new deployment to
   take effect).
5. This also needs `FIREBASE_SERVICE_ACCOUNT_KEY` set (see the Google
   Drive/GitHub section below) — you already have this configured since
   Drive access uses it too.

Once those env vars are set and the app's redeployed, "Continue with
LinkedIn" on `/signin` and `/join/[code]` will work as a normal full-page
redirect (no popup, so this also works inside the Electron shell, which
popup-based sign-in never reliably did).

**"Connect LinkedIn" in Preferences** (`/account`) now works too, and
doesn't need any extra LinkedIn app config beyond what's above — it reuses
the exact same callback URL. It's a different code path from sign-in,
though, because Firebase Auth has no supported way to attach an arbitrary
OIDC identity to an *already signed-in* user from the server (linking is a
client-only operation, and needs precisely the credential verification
Firebase's connector can't do for LinkedIn). So rather than trying to make
LinkedIn a real Firebase Auth provider on the account:

- `app/api/auth/linkedin/link-start/route.js` — like `start/route.js`, but a
  POST that takes the caller's Firebase ID token (verified via the Admin
  SDK) and stashes their uid in a short-lived httpOnly cookie before
  redirecting to Linkedin.
- `app/api/auth/linkedin/callback/route.js` — when that cookie is present,
  it saves the LinkedIn profile straight onto
  `profiles/{uid}/private/integrations` (`linkedinConnected: true` +
  name/email/sub) instead of minting a sign-in custom token, then redirects
  back to `/account`.

"Connected" in Preferences and on the profile page reads that
`linkedinConnected` flag, not `user.providerData` — LinkedIn will never show
up in Firebase Auth's own provider list for an account connected this way,
which is expected.

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

## AI features (chat summaries, role suggestions)

`app/api/ai/route.js` proxies both of those (and anything else built on
`lib/ai.js`'s `aiComplete`/`aiCompleteJSON`) through **Google's Gemini API**.
This used to run through Pollinations.ai's free public endpoint, which
worked with no key at all — but Pollinations moved to a paid "Pollen"
credit system, and the free/anonymous tier isn't enough for the model this
app needs (shows up as a 402 error). Gemini's free tier needs a key, but
the key itself costs nothing and needs no credit card:

1. Go to **[aistudio.google.com](https://aistudio.google.com)** and sign in
   with any Google account.
2. Click **Get API key** (top left or under your profile) → **Create API
   key**. Pick the same GCP project as `blueprint-drs` if it offers a
   choice, or let it create a new one — either works, this key isn't tied
   to Firebase.
3. Copy the key.
4. In **Vercel → your project → Settings → Environment Variables**, add
   `GEMINI_API_KEY` with that value, Production environment.
5. Redeploy.

Free tier is rate-limited (roughly 10 requests/minute, a few hundred/day on
the `gemini-2.5-flash` model this route uses) — plenty for occasional
summaries/suggestions, but if it ever gets hit hard, `app/api/ai/route.js`
surfaces a 429 as "Hit the free daily AI limit" rather than failing
silently.

## Focus modes

The topbar has a status/focus picker next to the avatar (`app/components/
FocusMode.js`) — Available, Focusing, In a meeting, Away, plus any custom
ones a person creates for themselves (name + any color, via the "+ Custom
focus" row in the same dropdown — no separate page). Saved to
`profiles/{uid}.focusMode`; for a custom one, the label/color are also
denormalized onto `profiles/{uid}.activeFocusLabel`/`activeFocusColor` so
teammates' browsers can render it without needing to read the owner's
private list of custom focuses (see the comment above `focusModeInfo()` in
`FocusMode.js` for why).

It shows up in three places: the small presence dot itself (colored per
focus mode when online, hover it for the label), team chat's Team rail, and
Overview's Team panel. It's still purely a signal, not an app behavior
switch — with one exception: "Auto-away" (Preferences → Notifications →
Presence) will automatically flip your own focus to "Away" after N idle
minutes and back to "Available" the moment you're active again, but only
ever touches it in that one automatic way — it never overrides a status you
picked yourself.

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

## Desktop app download button

The landing page (`app/page.js`) now has a "Download for [your OS]" button
next to "Get started" (auto-detects Mac/Windows/Linux from the browser, plus
small links for the other two). `electron/` already had a working desktop
wrapper — it just loads the live site in a window, no site code is bundled
into it — but nothing was actually building it into installer files or
publishing them anywhere. That's what's new here: `electron/package.json`
now pins each installer to a fixed filename (`Blueprint-mac.dmg`,
`Blueprint-win.exe`, `Blueprint-linux.AppImage`) so the download links never
need to change between versions, and a GitHub Actions workflow builds and
publishes them.

**This needs three things you'll have to do by hand — I don't have write
access to your repo root (`.github/` isn't in a folder I could reach this
session) or to Vercel/GitHub's settings:**

1. **Add the workflow file.** I saved it to your outputs as
   `build-desktop.yml` — on github.com, go to your repo → **Add file → Create
   new file**, name it exactly `.github/workflows/build-desktop.yml` (typing
   the slashes creates the folders), paste the contents of that file, then
   **Commit directly to main**.
2. **Set `NEXT_PUBLIC_GITHUB_REPO` in Vercel** → your project → **Settings →
   Environment Variables** → add `NEXT_PUBLIC_GITHUB_REPO` = `owner/repo`
   (e.g. `dhruvrajsingh/blueprint` — whatever your repo's actually called),
   Production environment, then redeploy. The Download button won't render
   at all until this is set (it has nothing to link to otherwise).
3. **Trigger a build.** The workflow runs on any push of a tag starting with
   `v` (e.g. `v1.0.0`), which you can do entirely from github.com — go to
   your repo → **Releases → Draft a new release** → under "Choose a tag"
   type a new tag like `v1.0.0` → **Publish release**. That push kicks off
   three parallel builds (macOS/Windows/Linux) in the **Actions** tab, each
   takes a few minutes, and once all three finish the workflow attaches the
   three installers to that same release automatically. After that, the
   Download button's links (`.../releases/latest/download/Blueprint-*.{ext}`)
   resolve immediately — no further action needed for future updates beyond
   pushing a new tag when you want to ship a new build.

You can also trigger a build without releasing anything yet, to sanity-check
it actually compiles: **Actions** tab → "Build desktop app" workflow → **Run
workflow**. That builds on all three platforms and lets you download the
raw artifacts from the run's summary page, but doesn't publish a release
(only tag pushes do that).

**Update, after the first real run:** the `v1.0.0` release only got 2 of 3
installers — the Linux (`ubuntu-latest`) build failed and, because the
matrix's default `fail-fast` behavior cancels sibling jobs, took the
in-progress macOS/Windows jobs down with it before they could finish
cleanly (they'd actually already produced usable files by then, which is
why 2 assets still made it onto the release). Root cause: GitHub's
`ubuntu-latest` runner is now Ubuntu 24.04, which dropped `libfuse2` from
the base image — `electron-builder`'s AppImage step needs it to run
`appimagetool`, so only the Linux leg broke. Fixed in the workflow (install
`libfuse2` before building, and `fail-fast: false` so one platform failing
never cancels the others again) — re-save `build-desktop.yml` with the
updated version, then push a new tag (e.g. `v1.0.1`) to get a clean
three-installer release.

One limitation worth knowing: none of the three installers are code-signed
(that needs a paid Apple Developer account for macOS and a certificate for
Windows), so macOS will show an "unidentified developer" warning and
Windows SmartScreen may warn too (More info → Run anyway). On recent macOS
versions there's no simple right-click-to-bypass anymore for a fully
unsigned app — go to **System Settings → Privacy & Security**, scroll down
to the blocked-app notice, and click **Open Anyway**, or run
`xattr -cr /Applications/Blueprint.app` in Terminal. This is cosmetic, not
a sign of anything actually wrong — see the next section for a *different*,
more serious warning macOS may show ("contains malware") that this doesn't
cover.

## Desktop app: Google/GitHub sign-in no longer uses an embedded popup

**What broke:** the desktop app's Google/GitHub sign-in used to load
Google's/GitHub's real login page inside an Electron popup with a spoofed
Chrome user-agent (the "standard" workaround for Google's
`disallowed_useragent` block). On macOS, that got the whole app deleted the
moment someone tried it — "'Blueprint' was not opened because it contains
malware" — because a fake-browser window loading a real Google/GitHub login
screen is exactly the shape of a credential-phishing attack. Apple's
on-device malware scanner (XProtect) very likely has a signature for
precisely that pattern, unsigned-app or not.

**The fix:** Google/GitHub sign-in (and "Connect"/"Refresh" from
Preferences) now happens in the user's real, already-installed browser —
never inside an Electron window — using the same pattern Slack, Discord,
and VS Code use for desktop OAuth:

1. The desktop shell asks the OS to open a sign-in URL in the real browser
   (`electron/preload.js`'s `openExternal`, allowlisted to Google/GitHub's
   OAuth domains only).
2. That completes a normal server-side OAuth code exchange —
   `app/api/auth/google/desktop-start` + `desktop-callback`, and the same
   pair for `github` — which mints a Firebase custom token (matched to the
   *same* uid as web sign-in, via `getUserByProviderUid`, so switching
   between web and desktop never creates a duplicate account).
3. The callback redirects the real browser to a `blueprint://auth-callback`
   link. The OS routes that straight back into the already-running desktop
   app (`electron/main.js`'s `open-url`/second-instance handling), which
   loads `app/desktop-auth` with the token in the URL to finish signing in.

No UA spoofing, no embedded OAuth pages, anywhere. `lib/desktopAuth.js` has
the full writeup; `app/signin/page.js`, `app/join/[code]/page.js`, and
`app/account/page.js` all branch to this flow only when
`window.blueprintDesktop?.isDesktop` is true (i.e. only inside the desktop
shell) — the web app is completely unchanged.

**Three setup steps for this to actually work once you rebuild:**

1. **Google:** add one redirect URI to the *existing* second OAuth Client ID
   (from "Drive/Calendar tokens now refresh themselves" above — same
   `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`, no new
   credentials needed). In Google Cloud Console → that Client ID →
   **Authorized redirect URIs → Add URI** →
   `https://<your-domain>/api/auth/google/desktop-callback`.
2. **GitHub needs a brand new OAuth App.** GitHub OAuth Apps (classic) only
   support *one* callback URL each, and the existing one is already locked
   to Firebase's own handler (`.../__/auth/handler`) for the web sign-in
   popup — it can't also point here. Go to
   [github.com/settings/developers](https://github.com/settings/developers)
   → **New OAuth App** → Authorization callback URL
   `https://<your-domain>/api/auth/github/desktop-callback` → create it →
   copy the Client ID, generate a Client secret, copy that too. In Vercel →
   Environment Variables, add `GITHUB_DESKTOP_CLIENT_ID` and
   `GITHUB_DESKTOP_CLIENT_SECRET`, then redeploy.
3. **Rebuild the desktop app.** `electron/package.json` now registers the
   `blueprint://` protocol scheme (needed for step 3 of the flow above) —
   this only takes effect in a freshly built installer, not the ones
   already published. Push a new tag (see "Desktop app download button"
   above) once the two steps above are done.

**One known cosmetic gap:** signing in (or connecting Google/GitHub) via
this desktop flow doesn't add a `google.com`/`github.com` entry to Firebase
Auth's own `providerData` — the Admin SDK can create the *same* underlying
account, but can't fabricate a real linked-provider record the way an
actual popup sign-in does. Practically: the Account page's "Connected"
badge next to Google/GitHub may not light up for someone who only ever
used the desktop app, even though Drive/Calendar/repo access is genuinely
working (same as LinkedIn's badge already works differently — see
`isLinkedinConnected()` above). Cosmetic only; doesn't affect anything
functional. Signing into the *web* app with the same Google/GitHub account
at least once will make the badge line up.

Also worth knowing: `getUserByProviderUid` needs a reasonably recent
`firebase-admin` (v11.5+). If it's missing/older, these routes just fall
back to matching by email instead of failing outright — you'd only notice
if someone signs in via desktop and web with a Google/GitHub account whose
email isn't verified/available, which is an edge case, not a hard blocker.

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
  // Anyone signed in can send one, but only as themselves, and it always
  // starts pending with an empty reply thread.
  allow create: if request.auth != null
    && request.resource.data.fromUid == request.auth.uid
    && request.resource.data.status == 'pending'
    && request.resource.data.replies.size() == 0;
  // Only the sender or the recipient can read a given request.
  allow read: if request.auth != null
    && (resource.data.toUid == request.auth.uid || resource.data.fromUid == request.auth.uid);
  // Only the recipient can flip `read`, or accept/deny a still-pending
  // request. Once accepted, either side (sender or recipient) can append to
  // `replies` — that's the capped little reply thread in the mailbox — but
  // nothing else about the request is ever editable after it's sent.
  allow update: if request.auth != null
    && (resource.data.toUid == request.auth.uid || resource.data.fromUid == request.auth.uid)
    && (
      (resource.data.toUid == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read', 'status']))
      || (resource.data.status == 'accepted'
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['replies']))
    );
}
```

Reply threads unlock once the recipient accepts a request (Accept/Deny buttons
show on a pending one in the mailbox). Deliberately not real chat — `replies`
is a plain array on the request doc, capped client-side at
`MAX_THREAD_LENGTH` (8 total messages) in `Mailbox.js`, both sides can add to
it once accepted, and a denied request never unlocks it.
