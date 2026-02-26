import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: "postgresql://celion:celion@localhost:5432/celion" });

async function getLogs() {
  const migrationId = 'af01424f-7e64-4d3f-b8a0-c298d9f3f33f';
  const query = "SELECT ms.result FROM migration_steps ms JOIN workflow_steps ws ON ms.workflow_step_id = ws.id WHERE ms.migration_id = $1 AND ws.key = 'data-staging'";
  const res = await pool.query(query, [migrationId]);
  if (res.rows[0]) {
    const result = res.rows[0].result;
    console.log("Status: " + result.status);
    console.log("Staged Count: " + result.stagedCount);
    console.log("Logs:");
    if (result.logs) {
      result.logs.forEach((log) => console.log(log));
    }
  } else {
    console.log('No Step 5 result found');
  }
  await pool.end();
}
getLogs();
