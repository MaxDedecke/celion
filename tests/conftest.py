import pytest
import os
from unittest.mock import MagicMock, patch

# Mock environment variables for testing
os.environ["POSTGRES_DB"] = "test_db"
os.environ["POSTGRES_USER"] = "test_user"
os.environ["POSTGRES_PASSWORD"] = "test_pass"
os.environ["POSTGRES_HOST"] = "localhost"
os.environ["NEO4J_URI"] = "bolt://localhost:7687"
os.environ["NEO4J_USER"] = "neo4j"
os.environ["NEO4J_PASSWORD"] = "password"

@pytest.fixture(autouse=True)
def mock_db_connections(mocker):
    """Mock database connections globally to prevent real connections during tests."""
    # Mock the pool to avoid initialization errors
    mocker.patch("psycopg_pool.ConnectionPool")
    
    # Mock the context manager for DB connections
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    
    # This mocks the 'with get_db_connection() as conn' pattern
    mocker.patch("core.database.get_db_connection").return_value.__enter__.return_value = mock_conn
    
    mocker.patch("neo4j.GraphDatabase.driver")
    mocker.patch("pika.BlockingConnection")
    
    return mock_conn, mock_cur

@pytest.fixture
def mock_openai(mocker):
    """Fixture to mock OpenAI client and prevent API calls."""
    mock_client = MagicMock()
    # Mock chat completions
    mock_chat = MagicMock()
    mock_chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content='{"result": "mocked response"}'))]
    )
    mock_client.chat = mock_chat
    
    # Mock embeddings
    mock_embeddings = MagicMock()
    mock_embeddings.create.return_value = MagicMock(
        data=[MagicMock(embedding=[0.1] * 1536)]
    )
    mock_client.embeddings = mock_embeddings
    
    with patch("openai.OpenAI", return_value=mock_client):
        yield mock_client
