# CiteWise

Ask questions across your research papers. Every answer is footnoted with the exact page and sentence.

```
citewise/
├── backend/      FastAPI + LangChain  -> deploys to Render (Docker)
├── frontend/     Angular              -> deploys to Vercel
└── render.yaml   tells Render how to run the backend + persistent disk
```

## Run locally

**Backend** (terminal 1) — see `backend/README.md`
```bash
cd backend && py -m venv venv && .\venv\Scripts\Activate
pip install -r requirements.txt
cp .env.example .env        # add GROQ_API_KEY and a long random SECRET_KEY
uvicorn main:app --reload --port 8000
```

**Frontend** (terminal 2)
```bash
cd frontend && npm install && npm start     # http://localhost:4200
```

> **Already ran the first version?** The database gained a few columns (chat titles, Google).
> The backend adds them automatically on start-up, so you do **not** need to delete anything.

## Set up "Continue with Google" (optional, 5 minutes)

Without this the Google button simply doesn't appear; email + password still works.

1. Go to <https://console.cloud.google.com/> and create a project (or pick one).
2. Open **Google Auth Platform** and click **Get started**: app name, your email, audience **External**, finish.
3. **Clients -> Create client -> Web application.**
   Under **Authorized JavaScript origins** add:
   - `http://localhost:4200`
   - your Vercel URL, e.g. `https://citewise.vercel.app` (no trailing slash)

   Leave *redirect URIs* empty; the Google button doesn't use them.
4. Copy the **Client ID** (looks like `123…apps.googleusercontent.com`). You do not need the client secret.
5. Put it in `GOOGLE_CLIENT_ID`: in `backend/.env` locally, and in the Render dashboard -> Environment.
6. **Audience tab:** while the app is in *Testing*, only people you list under *Test users* can sign in.
   To let anyone sign in, click **Publish app**. (CiteWise only asks for email + profile, which Google treats
   as non-sensitive, so no review is needed.)

Heads-up: if someone first made a password account with an email and later clicks "Continue with Google"
for that same email, Google proves they own it, so their old password is switched off and they use Google
from then on. This stops someone from pre-registering another person's email.

## Deploy (do it in this order)

### 1. Push to GitHub
Put the whole `citewise/` folder in one repo. (`.env` and `storage/` are git-ignored — never commit them.)

### 2. Backend on Render (Docker + persistent disk)
1. Render dashboard -> **New + -> Blueprint** -> choose your repo. It reads `render.yaml`.
2. Fill in the secret values it asks for:
   - `GROQ_API_KEY` — your Groq key
   - `GOOGLE_CLIENT_ID` — from the section above (leave blank to skip Google)
   - `FRONTEND_ORIGINS` — put `http://localhost:4200` for now (you'll change it in step 4)
3. Deploy. The first build is slow (10+ min): it downloads PyTorch and the AI models once.
4. Open `https://<your-service>.onrender.com/health` — you should see `{"status":"ok"}`.

The **persistent disk** (`/data`, 5 GB) keeps users, papers, chats and the search index across
restarts. It needs a paid Render plan.

### 3. Frontend on Vercel
1. Edit `frontend/src/environments/environment.prod.ts`: set `apiBaseUrl` to your Render URL
   (no trailing slash). Commit and push.
2. Vercel -> **Add New Project** -> your repo -> set **Root Directory** to `frontend`. Deploy.

### 4. Connect them (CORS)
In Render -> your service -> **Environment**, set `FRONTEND_ORIGINS` to your Vercel URL
(e.g. `https://citewise.vercel.app`, no trailing slash). Save — Render redeploys.
Also add that same Vercel URL to the Google client's *Authorized JavaScript origins* (step above).

## After launch
- **Logs:** Render -> your service -> Logs (also saved in `/data/logs/app.log`)
- **Close sign-ups** once your friends have accounts: set `ALLOW_REGISTRATION=false`
  (this also stops brand-new people joining through Google; existing users can still log in)
- **Backups:** the disk holds all data — Render can snapshot it (Disks tab)
