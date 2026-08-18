from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> repo root, where the single shared .env lives.
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_model: str = "gpt-4.1-mini"
    # Generous enough that a slow but succeeding extraction is not thrown away,
    # bounded so a hung connection cannot pin a request open indefinitely. The
    # 5 second requirement is enforced by measurement, never by this timeout.
    openai_timeout_seconds: float = 30.0
    # Zero by decision rather than by omission. A retry hides inside the elapsed
    # time the response reports, which is the one number this project has to be
    # able to trust. See approach.md section 6.
    openai_max_retries: int = 0
    # Kept as a raw comma-separated string so pydantic-settings does not try to
    # JSON-decode the env value; split via allowed_origins_list.
    allowed_origins: str = "http://localhost:5173"
    port: int = 8000

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """One `Settings` for the process, resolved once and shared.

    A FastAPI dependency so a test can override it, and cached so reading the
    `.env` file does not land in the request path.
    """
    return Settings()
