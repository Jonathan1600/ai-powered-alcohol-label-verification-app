from fastapi.testclient import TestClient

from app import main
from app.config import Settings

client = TestClient(main.app)


def test_health_returns_ok_and_model(monkeypatch):
    monkeypatch.setattr(main, "settings", Settings(openai_model="gpt-5.6-luna"))

    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["model"] == "gpt-5.6-luna"
