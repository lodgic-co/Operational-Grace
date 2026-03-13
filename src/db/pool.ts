import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

const LIVE_SCHEMA = 'operational_grace';
const TRAINING_SCHEMA = 'operational_grace_training';

const sslConfig = process.env['PG_SSL'] === 'false' ? {} : { ssl: { rejectUnauthorized: false } };

const poolBase = {
  connectionString: config.DATABASE_URL,
  ...sslConfig,
  max: config.DB_POOL_SIZE,
  connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
};

export const livePool = new Pool(poolBase);
export const trainingPool = new Pool(poolBase);

livePool.on('connect', (client) => {
  client.query(`SET search_path TO ${LIVE_SCHEMA}`).catch((err: unknown) => {
    // A connection that failed to set search_path would silently query the
    // wrong schema. Log and terminate rather than continuing in an unsafe state.
    console.error(
      `[operational-grace] FATAL: failed to SET search_path TO ${LIVE_SCHEMA} on live pool connection:`,
      err,
    );
    process.exit(1);
  });
});

trainingPool.on('connect', (client) => {
  client.query(`SET search_path TO ${TRAINING_SCHEMA}`).catch((err: unknown) => {
    console.error(
      `[operational-grace] FATAL: failed to SET search_path TO ${TRAINING_SCHEMA} on training pool connection:`,
      err,
    );
    process.exit(1);
  });
});

export async function closePools(): Promise<void> {
  await Promise.all([livePool.end(), trainingPool.end()]);
}
