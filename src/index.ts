import { config, emitDeprecationWarnings } from './config/index.js';
import { shutdownOtel, verifyTelemetry } from './observability/otel.js';
import { createApp } from './http/app.js';
import { setReady, setDbPools } from './routes/health.js';
import { livePool, trainingPool, closePools } from './db/pool.js';
import { createMeasuredJudgementClient } from './http/measured-judgement-client.js';
import { loadCapabilityAllowlistMap } from './http/service-capability-loader.js';

verifyTelemetry(config.OTEL_EXPORTER_OTLP_ENDPOINT);

const mjClient = createMeasuredJudgementClient(config.MEASURED_JUDGEMENT_BASE_URL);

const start = async (): Promise<void> => {
  try {
    const capabilityAllowlistMap = await loadCapabilityAllowlistMap('operational-grace');
    const app = createApp({ mjClient, livePool, trainingPool, capabilityAllowlistMap });
    emitDeprecationWarnings(app.log);
    app.log.info(
      { capability_count: capabilityAllowlistMap.size },
      'service_capability_allowlist_loaded',
    );
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    setDbPools(livePool, trainingPool);
    setReady(true);
    app.log.info(`Server listening on port ${config.PORT}`);
  } catch (err) {
    console.error('Startup failed', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => {
  void (async () => {
    setReady(false);
    await closePools();
    await shutdownOtel();
    process.exit(0);
  })();
});
process.on('SIGINT', () => {
  void (async () => {
    setReady(false);
    await closePools();
    await shutdownOtel();
    process.exit(0);
  })();
});

start();
