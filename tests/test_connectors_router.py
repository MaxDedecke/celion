import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock
from datetime import datetime

# Import the app (assuming it's in main.py)
from main import app

client = TestClient(app)

def test_get_connectors(mocker):
    # Mock the cursor to return a sample row
    mock_conn = mocker.patch("core.database.get_db_connection").return_value.__enter__.return_value
    mock_cur = mock_conn.cursor.return_value.__enter__.return_value
    
    mock_cur.fetchall.return_value = [
        {
            "id": "123",
            "migration_id": "mig-456",
            "connector_type": "source",
            "api_url": "https://api.example.com",
            "api_key": "secret",
            "username": "user",
            "password": "pass",
            "endpoint": "v1",
            "auth_type": "api_key",
            "additional_config": None,
            "is_tested": True,
            "created_at": datetime.now(),
            "updated_at": None,
        }
    ]
    
    response = client.get("/api/connectors?migration_id=mig-456")
    
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == "123"
    assert data[0]["migration_id"] == "mig-456"

def test_create_connector(mocker):
    mock_conn = mocker.patch("core.database.get_db_connection").return_value.__enter__.return_value
    mock_cur = mock_conn.cursor.return_value.__enter__.return_value
    
    mock_cur.fetchone.return_value = {
        "id": "789",
        "migration_id": "mig-456",
        "connector_type": "target",
        "api_url": "https://target.example.com",
        "api_key": "target-secret",
        "username": None,
        "password": None,
        "endpoint": None,
        "auth_type": "api_key",
        "additional_config": None,
        "is_tested": False,
        "created_at": datetime.now(),
        "updated_at": None,
    }
    
    payload = [
        {
            "migration_id": "mig-456",
            "connector_type": "target",
            "api_url": "https://target.example.com",
            "api_key": "target-secret",
            "auth_type": "api_key"
        }
    ]
    
    response = client.post("/api/connectors", json=payload)
    
    assert response.status_code == 200
    data = response.json()
    assert data[0]["id"] == "789"
    assert mock_cur.execute.called
