"""Celion FastAPI entry point."""
# pyright: reportMissingImports=false

from __future__ import annotations

import json
import sys
import os
import asyncio
from typing import Any

import aio_pika
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from core.database import json_dumps, init_db_pool, close_db_pool
from core.websocket import manager
from routers import (
    data_sources, auth, projects, tools, 
    neo4j_router, stats, settings, connectors, migrations
)

app = FastAPI(title="Celion Agent Service", version="1.0.0")

# CORS configuration
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "*")
allowed_origins = allowed_origins_env.split(",") if allowed_origins_env != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)

async def rabbitmq_listener():
    rabbitmq_host = os.getenv("RABBITMQ_HOST", "localhost")
    rabbitmq_user = os.getenv("RABBITMQ_DEFAULT_USER", "guest")
    rabbitmq_pass = os.getenv("RABBITMQ_DEFAULT_PASS", "guest")
    
    connection = None
    for _ in range(10):
        try:
            connection = await aio_pika.connect_robust(
                f"amqp://{rabbitmq_user}:{rabbitmq_pass}@{rabbitmq_host}/"
            )
            print("Successfully connected to aio-pika for WebSockets.")
            break
        except Exception as e:
            print(f"Waiting for RabbitMQ for WebSockets... {e}")
            await asyncio.sleep(5)
            
    if not connection:
        print("Failed to connect to RabbitMQ for WebSockets after 10 attempts.")
        return

    async with connection:
        channel = await connection.channel()
        exchange = await channel.declare_exchange('celion.events', aio_pika.ExchangeType.TOPIC, durable=True)
        
        # Exclusive queue that dies when the server stops
        queue = await channel.declare_queue(exclusive=True)
        await queue.bind(exchange, routing_key='migration.#')

        async with queue.iterator() as queue_iter:
            async for message in queue_iter:
                async with message.process():
                    try:
                        data = json.loads(message.body.decode())
                        migration_id = data.get('migration_id')
                        if migration_id:
                            await manager.broadcast_to_migration(migration_id, data)
                    except Exception as e:
                        print(f"Error processing websocket event: {e}")

@app.on_event("startup")
async def startup_event():
    init_db_pool()
    asyncio.create_task(rabbitmq_listener())

@app.on_event("shutdown")
async def shutdown_event():
    close_db_pool()

@app.websocket("/api/v1/ws/migrations/{migration_id}")
async def websocket_endpoint(websocket: WebSocket, migration_id: str):
    await manager.connect(websocket, migration_id)
    try:
        while True:
            # Keep connection open, client doesn't need to send data
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, migration_id)

# Include Routers
app.include_router(data_sources.router, prefix="/api/data_sources", tags=["data_sources"])
app.include_router(auth.router, tags=["auth"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(tools.router, prefix="/api", tags=["tools"])
app.include_router(neo4j_router.router, prefix="/api/neo4j", tags=["neo4j"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(settings.router, prefix="/api", tags=["settings"])
app.include_router(connectors.router, prefix="/api/connectors", tags=["connectors"])
app.include_router(migrations.router, tags=["migrations"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
