import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';

const ROUTES_DIR = join(process.cwd(), 'src', 'routes');
const OPENAPI_PATH = join(process.cwd(), 'openapi', 'openapi.yaml');

const FASTIFY_PARAM_RE = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;

function toOpenApiPath(fastifyPath: string): string {
  return fastifyPath.replace(FASTIFY_PARAM_RE, '{$1}').replace(/\/+$/, '');
}

function extractFastifyRoutes(): Set<string> {
  const routes = new Set<string>();
  const files = readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));

  const routePattern = /app\.(get|post|put|delete|patch|head|options)\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  for (const file of files) {
    const content = readFileSync(join(ROUTES_DIR, file), 'utf-8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    let match: RegExpExecArray | null;
    while ((match = routePattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      // Routes are registered without the /live or /training prefix — that prefix
      // is added by the app-level plugin registration (see http/app.ts).
      // We record the bare path so we can match it against the OAS paths after
      // stripping the environment prefix there too.
      const path = toOpenApiPath(match[2]);
      routes.add(`${method} ${path}`);
    }
  }

  return routes;
}

function stripEnvPrefix(path: string): string {
  return path.replace(/^\/(live|training)/, '');
}

function extractOpenApiRoutes(): Set<string> {
  const spec = load(readFileSync(OPENAPI_PATH, 'utf-8')) as {
    paths?: Record<string, Record<string, unknown>>;
  };

  const routes = new Set<string>();
  const httpMethods = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

  if (spec.paths) {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        if (httpMethods.has(method)) {
          // Strip /live or /training prefix so OAS paths align with Fastify
          // route registrations, which are prefix-mounted by the app.
          routes.add(`${method.toUpperCase()} ${stripEnvPrefix(path)}`);
        }
      }
    }
  }

  return routes;
}

describe('Route-to-OpenAPI coverage', () => {
  const fastifyRoutes = extractFastifyRoutes();
  const openApiRoutes = extractOpenApiRoutes();

  it('discovers at least one Fastify route', () => {
    expect(fastifyRoutes.size).toBeGreaterThan(0);
  });

  it('discovers at least one OpenAPI route', () => {
    expect(openApiRoutes.size).toBeGreaterThan(0);
  });

  it('every Fastify route is documented in OpenAPI', () => {
    const missing: string[] = [];
    for (const route of fastifyRoutes) {
      if (!openApiRoutes.has(route)) {
        missing.push(route);
      }
    }
    expect(missing, `Fastify routes missing from OpenAPI:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('warns about OpenAPI routes not implemented in Fastify', () => {
    const extra: string[] = [];
    for (const route of openApiRoutes) {
      if (!fastifyRoutes.has(route)) {
        extra.push(route);
      }
    }
    if (extra.length > 0) {
      console.warn(`OpenAPI routes not found in Fastify implementation:\n  ${extra.join('\n  ')}`);
    }
  });

  it('route counts match', () => {
    expect(fastifyRoutes.size).toBe(openApiRoutes.size);
  });
});
