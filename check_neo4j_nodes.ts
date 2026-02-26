import neo4j from 'neo4j-driver';

const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic('neo4j', 'password'));

async function debug() {
  const session = driver.session();
  const migrationId = 'af01424f-7e64-4d3f-b8a0-c298d9f3f33f';
  try {
    const res = await session.run('MATCH (n {migration_id: $migrationId}) RETURN labels(n) as labels, n.entity_type as type, count(n) as count', { migrationId });
    console.log(res.records.map(r => ({labels: r.get('labels'), type: r.get('type'), count: r.get('count').toNumber()})));
  } catch (e) {
    console.error(e);
  } finally {
    await session.close();
    await driver.close();
  }
}
debug();
