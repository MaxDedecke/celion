import os
import sys
import neo4j

def get_neo4j_driver():
    """Create a new Neo4j driver using environment variables."""
    uri = os.getenv("NEO4J_URI", "bolt://neo4j-db:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "password")
    return neo4j.GraphDatabase.driver(uri, auth=(user, password))

async def duplicate_neo4j_data(old_id: str, new_id: str):
    """Clone all nodes and relationships from one migration to another in Neo4j."""
    driver = get_neo4j_driver()
    try:
        with driver.session() as session:
            # 1. Fetch all nodes for the old migration
            result = session.run(
                "MATCH (n {migration_id: $oldId}) RETURN labels(n) as labels, properties(n) as props",
                oldId=old_id
            )
            nodes = result.data()

            # 2. Re-create nodes with the new migration_id
            for node in nodes:
                labels = ":".join(node["labels"])
                props = dict(node["props"])
                props["migration_id"] = str(new_id)

                query = f"CREATE (n:{labels}) SET n = $props"
                session.run(query, props=props)

            # 3. Fetch all relationships for the old migration
            rel_result = session.run(
                """
                MATCH (s {migration_id: $oldId})-[r]->(t {migration_id: $oldId})
                RETURN type(r) as relType, properties(r) as relProps, 
                       s.external_id as sExt, t.external_id as tExt,
                       labels(s) as s_labels, labels(t) as t_labels
                """,
                oldId=old_id
            )
            rels = rel_result.data()

            # 4. Re-create relationships between the new nodes
            for rel in rels:
                if not rel["sExt"] or not rel["tExt"]:
                    continue

                s_labels = ":".join(rel["s_labels"])
                t_labels = ":".join(rel["t_labels"])

                query = f"""
                    MATCH (s:{s_labels} {{external_id: $sExt, migration_id: $newId}})
                    MATCH (t:{t_labels} {{external_id: $tExt, migration_id: $newId}})
                    CREATE (s)-[r:`{rel["relType"]}`]->(t)
                    SET r = $relProps
                """
                session.run(query, sExt=rel["sExt"], tExt=rel["tExt"], newId=str(new_id), relProps=rel["relProps"])

    except Exception as e:
        print(f"Error duplicating Neo4j data: {e}", file=sys.stderr)
    finally:
        driver.close()

async def delete_neo4j_data(migration_id: str):
    """Delete all nodes and relationships associated with a migration in Neo4j."""
    driver = get_neo4j_driver()
    try:
        with driver.session() as session:
            # DETACH DELETE ensures relationships are also removed
            session.run(
                "MATCH (n {migration_id: $id}) DETACH DELETE n",
                id=migration_id
            )
    except Exception as e:
        print(f"Error deleting Neo4j data: {e}", file=sys.stderr)
    finally:
        driver.close()
