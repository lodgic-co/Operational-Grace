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
  void client.query(`SET search_path TO ${LIVE_SCHEMA}`);
});

trainingPool.on('connect', (client) => {
  void client.query(`SET search_path TO ${TRAINING_SCHEMA}`);
});

export async function closePools(): Promise<void> {
  await Promise.all([livePool.end(), trainingPool.end()]);
}
