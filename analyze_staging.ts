import pkg from 'pg';
const { Pool } = pkg;
import neo4j from 'neo4j-driver';

const pool = new Pool({ connectionString: "postgresql://celion:celion@localhost:5432/celion" });
const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "password"));

async function analyze() {
  const migrationId = 'af01424f-7e64-4d3f-b8a0-c298d9f3f33f';
  console.log("--- ANALYSE MIGRATION " + migrationId + " ---");
  const step3 = await pool.query('SELECT entity_name, count FROM step_3_results WHERE migration_id = $1', [migrationId]);
  console.log('Step 3 Inventory:');
  step3.rows.forEach(r => console.log(' - ' + r.entity_name + ': ' + r.count));
  const session = driver.session();
  try {
    const neoRes = await session.run(
      'MATCH (n) WHERE n.migration_id = $migrationId RETURN n.entity_type as type, count(n) as count',
      { migrationId }
    );
    console.log('Neo4j Actual:');
    neoRes.records.forEach(r => console.log(' - ' + r.get('type') + ': ' + r.get('count')));
  } finally {
    await session.close();
  }
  await pool.end();
  await driver.close();
}
analyze();
