/**
 * OpenAPI environment-boundary symmetry guard (M37)
 *
 * Asserts that every /live/... path in the OpenAPI spec has a corresponding
 * /training/... counterpart and vice versa. This test will fail if a future
 * feature adds only one variant of a reservation-family endpoint.
 *
 * Does not use a YAML parser; instead extracts top-level path keys using
 * a simple regex that matches the OpenAPI 3.x paths-section indentation
 * convention (`  /path/to/resource:`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SPEC_PATH = resolve('openapi/openapi.yaml');

// Matches top-level path entries in the spec.
// OpenAPI 3.x paths are indented with exactly 2 spaces and start with '/'.
// Using the full spec content is safe: only path keys start with 2 spaces + '/'.
const PATH_ENTRY_RE = /^ {2}(\/[^\s:#{}]+(?:\{[^}]+\}[^\s:#{}]*)*(?:\/[^\s:#{}]*(?:\{[^}]+\}[^\s:#{}]*)*)*):/gm;

function extractPaths(specContent: string): string[] {
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(PATH_ENTRY_RE.source, PATH_ENTRY_RE.flags);
  while ((match = re.exec(specContent)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

function liveVariantOf(path: string): string {
  return path.replace(/^\/training\//, '/live/');
}

function trainingVariantOf(path: string): string {
  return path.replace(/^\/live\//, '/training/');
}

describe('OpenAPI environment-boundary symmetry guard (M37)', () => {
  const specContent = readFileSync(SPEC_PATH, 'utf-8');
  const allPaths = extractPaths(specContent);

  const livePaths = allPaths.filter((p) => p.startsWith('/live/'));
  const trainingPaths = allPaths.filter((p) => p.startsWith('/training/'));

  it('extracts at least one /live/ path', () => {
    expect(livePaths.length, 'No /live/ paths found in OpenAPI spec').toBeGreaterThan(0);
  });

  it('extracts at least one /training/ path', () => {
    expect(trainingPaths.length, 'No /training/ paths found in OpenAPI spec').toBeGreaterThan(0);
  });

  it('every /live/ path has a corresponding /training/ variant', () => {
    const missing = livePaths
      .map(trainingVariantOf)
      .filter((expected) => !trainingPaths.includes(expected));
    expect(
      missing,
      `The following /live/ paths have no /training/ counterpart:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every /training/ path has a corresponding /live/ variant', () => {
    const missing = trainingPaths
      .map(liveVariantOf)
      .filter((expected) => !livePaths.includes(expected));
    expect(
      missing,
      `The following /training/ paths have no /live/ counterpart:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('/live/ and /training/ path counts are equal', () => {
    expect(
      livePaths.length,
      `/live/ count (${livePaths.length}) !== /training/ count (${trainingPaths.length})`,
    ).toBe(trainingPaths.length);
  });
});
