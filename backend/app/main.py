from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import REPO_ROOT, Settings

# Export OPENAI_API_KEY (and anything else in .env) into the process
# environment so the OpenAI SDK picks it up under its default variable name.
# pydantic-settings reads the file for its own fields but does not export.
load_dotenv(REPO_ROOT / ".env")

settings = Settings()

app = FastAPI(title="TTB Label Verification API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": settings.openai_model}
