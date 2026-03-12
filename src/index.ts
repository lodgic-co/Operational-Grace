import { config, emitDeprecationWarnings } from './config/index.js';
import { shutdownOtel } from './observability/otel.js';
import { createApp } from './http/app.js';
import { setReady, setDbPools } from './routes/health.js';
import { livePool, trainingPool, closePools } from './db/pool.js';
import { createMeasuredJudgementClient } from './http/measured-judgement-client.js';

const mjClient = createMeasuredJudgementClient(config.MEASURED_JUDGEMENT_BASE_URL);
const app = createApp({ mjClient, livePool, trainingPool });

const start = async (): Promise<void> => {
  try {
    emitDeprecationWarnings(app.log);
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    setDbPools(livePool, trainingPool);
    setReady(true);
    app.log.info(`Server listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'Shutting down');
  setReady(false);
  await app.close();
  await closePools();
  await shutdownOtel();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start();
