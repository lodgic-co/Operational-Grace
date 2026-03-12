const { spawnSync } = require('child_process');

const databaseUrl = process.env.DATABASE_URL_DIRECT;
if (!databaseUrl) {
  console.error('[seed-dev] DATABASE_URL_DIRECT is not set');
  process.exit(1);
}

const parsed = new URL(databaseUrl);
console.log(`[seed-dev] target: ${parsed.host}${parsed.pathname}`);

const schemas = [
  { schema: 'operational_grace',          table: 'pgmigrations_operational_grace_live_dev' },
  { schema: 'operational_grace_training', table: 'pgmigrations_operational_grace_training_dev' },
];

for (const { schema, table } of schemas) {
  console.log(`[seed-dev] running dev seed for schema: ${schema}`);

  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'node-pg-migrate',
      'up',
      '--migrations-dir', 'db/migrations_dev',
      '--database-url', databaseUrl,
      '--migrations-table', table,
      '--schema', schema,
    ],
    { stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl } },
  );

  if (result.status !== 0) {
    console.error(`[seed-dev] seed failed for schema: ${schema}`);
    process.exit(result.status ?? 1);
  }
}

console.log('[seed-dev] all schemas seeded successfully');
