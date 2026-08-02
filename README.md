# Blueprint

Next.js + Firebase app. Sign in with Google, GitHub, or LinkedIn; create projects;
real-time tasks/matches/chat; peer-to-peer video calling via WebRTC + Firestore signaling.

## Deploy this yourself

### 1. Push to GitHub

```bash
cd blueprint
git init
git add .
git commit -m "Initial commit"
gh repo create blueprint --private --source=. --push
# or manually: create a repo on github.com, then
# git remote add origin <your-repo-url>
# git branch -M main
# git push -u origin main
```

### 2. Import into Vercel

- Go to vercel.com → **Add New Project** → import the GitHub repo you just created.
- Framework preset should auto-detect as **Next.js**. No other config needed.
- Click **Deploy**.

### 3. Add your Anthropic API key (for the `/api/decompose` route, currently unused by the UI but present)

In Vercel → your project → **Settings → Environment Variables**, add:

- `ANTHROPIC_API_KEY` — from console.anthropic.com

### 4. Firestore setup (required for the app to actually work)

In the Firebase console for project `blueprint-drs`:

- **Authentication → Sign-in method**: confirm Google, GitHub, and the `oidc.linkedin` provider are enabled.
- **Firestore Database**: make sure it's created (Native mode, any region).
- **Firestore → Rules**, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /projects/{projectId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid in request.resource.data.memberIds;
      allow update, delete: if request.auth != null && request.auth.uid in resource.data.memberIds;

      match /tasks/{taskId} {
        allow read, write: if request.auth != null;
      }
      match /messages/{messageId} {
        allow read, write: if request.auth != null;
      }
    }

    match /candidates/{candidateId} {
      allow read, write: if request.auth != null;
    }

    match /calls/{callId} {
      allow read, write: if request.auth != null;
      match /{subcollection}/{docId} {
        allow read, write: if request.auth != null;
      }
    }

    match /profiles/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### 5. Add your new domain to Firebase's authorized domains

Whatever `*.vercel.app` URL Vercel gives you (or your custom domain), add it in
Firebase console → **Authentication → Settings → Authorized domains**, or sign-in
will fail with `auth/unauthorized-domain`.

## What's real vs. seeded

- Sign-in, dashboard, task board (drag/create), roles, chat, and video calling are
  all fully wired to Firestore — real data, real users.
- **Matches** seeds 5 fake candidate profiles into the `candidates` collection the
  first time you open that tab, so there's something to match against with only
  one real account testing it.
- The `/create` flow no longer calls the AI decomposition API — it's a fast,
  Discord-style "name it and go" flow. The `/api/decompose` route still exists if
  you want to wire AI decomposition back in later.

## Local development

```bash
npm install
npm run dev
```
