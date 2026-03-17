import os
from fastapi import APIRouter, HTTPException
from typing import Any
from starlette.concurrency import run_in_threadpool
import neo4j
from openai import OpenAI

from models.neo4j import Neo4jQueryPayload, Neo4jVectorSearchPayload
from core.database import get_db_connection, get_llm_settings
from core.neo4j_utils import get_neo4j_driver

router = APIRouter()

def _get_embeddings(text: str) -> list[float]:
    """Generate embeddings for the given text using OpenAI."""
    with get_db_connection() as conn:
        llm_settings = get_llm_settings(conn)
        api_key = llm_settings.get('api_key') if llm_settings else os.getenv("OPENAI_API_KEY")
        base_url = llm_settings.get('base_url') if llm_settings else None
        
        provider = llm_settings.get('provider') if llm_settings else 'openai'
        if provider in ['ollama', 'custom'] and not api_key:
            api_key = "dummy-key"
    
    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.embeddings.create(
        input=[text],
        model="text-embedding-3-small"
    )
    return response.data[0].embedding


def _get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a list of texts using OpenAI."""
    if not texts:
        return []
    with get_db_connection() as conn:
        llm_settings = get_llm_settings(conn)
        api_key = llm_settings.get('api_key') if llm_settings else os.getenv("OPENAI_API_KEY")
        base_url = llm_settings.get('base_url') if llm_settings else None
        
        provider = llm_settings.get('provider') if llm_settings else 'openai'
        if provider in ['ollama', 'custom'] and not api_key:
            api_key = "dummy-key"
    
    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.embeddings.create(
        input=texts,
        model="text-embedding-3-small"
    )
    return [item.embedding for item in response.data]


def _ensure_neo4j_vector_index(driver: neo4j.Driver, label: str):
    """Ensure a vector index exists in Neo4j for the given label."""
    # We use 1536 dimensions for text-embedding-3-small
    query = f"""
    CREATE VECTOR INDEX `vector_index_{label}` IF NOT EXISTS
    FOR (n:`{label}`)
    ON (n.embedding)
    OPTIONS {{
      indexConfig: {{
        `vector.dimensions`: 1536,
        `vector.similarity_function`: 'cosine'
      }}
    }}
    """
    with driver.session() as session:
        session.run(query)


@router.post("/query")
async def query_neo4j(payload: Neo4jQueryPayload):
    """Execute a Cypher query in Neo4j."""
    driver = get_neo4j_driver()
    try:
        with driver.session() as session:
            result = session.run(payload.query, **payload.params)
            return [dict(record) for record in result]
    except Exception as e:
        print(f"Neo4j query error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        driver.close()


@router.post("/vector-search")
async def vector_search_neo4j(payload: Neo4jVectorSearchPayload):
    """Perform a vector similarity search in Neo4j."""
    if not payload.source_system:
        raise HTTPException(status_code=400, detail="source_system is required for vector search index.")
        
    driver = get_neo4j_driver()
    try:
        embedding = await run_in_threadpool(_get_embeddings, payload.query_text)
        
        # Ensure index exists
        _ensure_neo4j_vector_index(driver, payload.source_system)
        
        query = f"""
        CALL db.index.vector.queryNodes('vector_index_{payload.source_system}', $limit, $embedding)
        YIELD node, score
        WHERE node.migration_id = $migration_id
        RETURN node, score
        """
        
        with driver.session() as session:
            result = session.run(
                query, 
                embedding=embedding, 
                limit=payload.limit, 
                migration_id=payload.migration_id
            )
            return [{"node": dict(record["node"]), "score": record["score"]} for record in result]
    except Exception as e:
        print(f"Neo4j vector search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        driver.close()


@router.post("/vectorize")
async def vectorize_migration(migration_id: str, source_system: str):
    """Vectorize all nodes for a specific migration and system."""
    driver = get_neo4j_driver()
    try:
        # 1. Fetch nodes that don't have an embedding yet
        query = f"""
        MATCH (n:`{source_system}`) 
        WHERE n.migration_id = $migration_id AND n.embedding IS NULL
        RETURN n.external_id as id, n.name as name, n.description as description, n.text as text
        """
        nodes_to_vectorize = []
        with driver.session() as session:
            result = session.run(query, migration_id=migration_id)
            nodes_to_vectorize = [dict(record) for record in result]
            
        if not nodes_to_vectorize:
            return {"status": "success", "message": "No nodes to vectorize."}
            
        # 2. Generate embeddings in batches and update nodes
        batch_size = 100
        for i in range(0, len(nodes_to_vectorize), batch_size):
            batch = nodes_to_vectorize[i:i + batch_size]
            texts_to_embed = []
            valid_nodes = []
            
            for node in batch:
                text = f"Name: {node.get('name', '')}\nDescription: {node.get('description', '')}\nText: {node.get('text', '')}"
                if text.strip():
                    texts_to_embed.append(text)
                    valid_nodes.append(node)
            
            if not texts_to_embed:
                continue
                
            embeddings = await run_in_threadpool(_get_embeddings_batch, texts_to_embed)
            
            with driver.session() as session:
                for node, embedding in zip(valid_nodes, embeddings):
                    session.run(
                        f"MATCH (n:`{source_system}`) WHERE n.migration_id = $migration_id AND n.external_id = $id "
                        f"SET n.embedding = $embedding",
                        migration_id=migration_id,
                        id=node['id'],
                        embedding=embedding
                    )
        
        return {"status": "success", "count": len(nodes_to_vectorize)}
    except Exception as e:
        print(f"Neo4j vectorization error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        driver.close()
