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


