import type { FastifyInstance } from 'fastify';

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/internal/ping', async (_request, reply) => {
    reply.code(200).send({ ok: true });
  });
}
