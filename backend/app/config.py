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
    # Kept as a raw comma-separated string so pydantic-settings does not try to
    # JSON-decode the env value; split via allowed_origins_list.
    allowed_origins: str = "http://localhost:5173"
    port: int = 8000

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]
