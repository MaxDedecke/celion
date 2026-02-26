import neo4j from 'neo4j-driver';

const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic('neo4j', 'password'));

async function debug() {
  const session = driver.session();
  const migrationId = 'af01424f-7e64-4d3f-b8a0-c298d9f3f33f';
  try {
    const res = await session.run(
      'MATCH (n {migration_id: $migrationId, entity_type: "task"}) RETURN n.name as name, n.external_id as id LIMIT 10', 
      { migrationId }
    );
    console.log("Tasks found:");
    res.records.forEach(r => console.log(` - ${r.get('name')} (ID: ${r.get('id')})`));
  } catch (e) {
    console.error(e);
  } finally {
    await session.close();
    await driver.close();
  }
}
debug();
