const { spawnSync } = require('child_process');

const databaseUrl = process.env.DATABASE_URL_DIRECT;
if (!databaseUrl) {
  console.error('[migrate] DATABASE_URL_DIRECT is not set');
  process.exit(1);
}

const parsed = new URL(databaseUrl);
console.log(`[migrate] target: ${parsed.host}${parsed.pathname}`);

const schemas = [
  { schema: 'operational_grace', table: 'pgmigrations_operational_grace_live' },
  { schema: 'operational_grace_training', table: 'pgmigrations_operational_grace_training' },
];

for (const { schema, table } of schemas) {
  console.log(`[migrate] running migrations for schema: ${schema}`);

  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'node-pg-migrate',
      'up',
      '--migrations-dir', 'db/migrations',
      '--database-url', databaseUrl,
      '--migrations-table', table,
      '--schema', schema,
      '--create-schema',
    ],
    { stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl } },
  );

  if (result.status !== 0) {
    console.error(`[migrate] migration failed for schema: ${schema}`);
    process.exit(result.status ?? 1);
  }
}

console.log('[migrate] all schemas migrated successfully');
