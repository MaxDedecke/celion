from typing import Dict, Any
from fastapi import WebSocket
from collections import defaultdict

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, migration_id: str):
        await websocket.accept()
        self.active_connections[migration_id].append(websocket)

    def disconnect(self, websocket: WebSocket, migration_id: str):
        if migration_id in self.active_connections:
            if websocket in self.active_connections[migration_id]:
                self.active_connections[migration_id].remove(websocket)
            if not self.active_connections[migration_id]:
                del self.active_connections[migration_id]

    async def broadcast_to_migration(self, migration_id: str, message: dict):
        if migration_id in self.active_connections:
            connections_to_remove = []
            for connection in self.active_connections[migration_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    connections_to_remove.append(connection)
            for conn in connections_to_remove:
                self.disconnect(conn, migration_id)

manager = ConnectionManager()
