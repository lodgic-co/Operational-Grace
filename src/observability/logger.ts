import type { FastifyServerOptions } from 'fastify';
import { config } from '../config/index.js';

export const loggerOptions: FastifyServerOptions['logger'] = {
  level: config.LOG_LEVEL,
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
  serializers: {
    req(request) {
      return {
        method: request.method,
        url: request.url,
        request_id: request.id,
      };
    },
    res(reply) {
      return {
        status_code: reply.statusCode,
      };
    },
  },
};
