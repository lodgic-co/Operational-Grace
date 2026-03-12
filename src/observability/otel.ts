import { trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { config } from '../config/index.js';

let sdk: NodeSDK | undefined;
let started = false;

export function initOtel(): void {
  if (started) {
    return;
  }
  started = true;

  const endpoint = config.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.OTEL_SERVICE_NAME,
  });

  const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
    exportIntervalMillis: 30_000,
  });

  const logRecordProcessor = new SimpleLogRecordProcessor(
    new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
  );

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    logRecordProcessor,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownOtel(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}

export function verifyTelemetry(endpoint: string | undefined): void {
  if (!endpoint) {
    return;
  }

  const tracer = trace.getTracer('startup-verify');
  const span = tracer.startSpan('otel-startup-check');
  const { traceId } = span.spanContext();
  span.end();

  const isNoOp = !traceId || traceId === '00000000000000000000000000000000';
  if (isNoOp) {
    throw new Error(
      'FATAL: OTEL_EXPORTER_OTLP_ENDPOINT is configured but OpenTelemetry SDK is not active. ' +
        'Ensure the service starts with: node --import ./dist/observability/otel-preload.js dist/index.js',
    );
  }
}
