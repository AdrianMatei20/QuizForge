/**
 * Creates the database in DATABASE_URL if it does not exist yet. Run by the
 * API container's entrypoint before the migrations, so the full Docker stack
 * can use its own database (quizforge_demo) on a PostgreSQL volume that was
 * initialised before it existed. Connects to the server's "postgres"
 * maintenance database with the same credentials.
 */
import pg from 'pg';

const url = new URL(process.env['DATABASE_URL'] ?? '');
const name = decodeURIComponent(url.pathname.slice(1));
// CREATE DATABASE cannot take a parameter, so the name is checked instead.
if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
  throw new Error(
    `DATABASE_URL must name a database of lowercase letters, digits and underscores (got "${name}")`,
  );
}

const maintenance = new URL(url);
maintenance.pathname = '/postgres';
const client = new pg.Client({ connectionString: maintenance.toString() });
await client.connect();
try {
  const existing = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [name],
  );
  if (existing.rowCount === 0) {
    await client.query(`CREATE DATABASE "${name}"`);
    console.log(`Created database ${name}`);
  }
} finally {
  await client.end();
}
