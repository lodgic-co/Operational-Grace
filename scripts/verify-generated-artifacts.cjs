#!/usr/bin/env node
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { basename, join, resolve } = require('node:path');

const serviceName = basename(process.cwd());
const OPENAPI_FILE = resolve('openapi/openapi.yaml');
const DECISION_PROCEDURES_DIR = resolve('decision-procedures/generated');
const DATA_MODEL_DIR = resolve('data-model/generated');
const REQUIRED_PI_OPERATION_KEYS = [
  'x-auth-mode',
  'x-tenant-scope',
  'x-public-surface',
  'x-error-envelope',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function listYamlFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.yaml'))
    .sort()
    .map((entry) => join(directory, entry));
}

function assertMarker(filePath, markerLine) {
  const content = readFileSync(filePath, 'utf8');
  const markerPattern = new RegExp(`^${escapeRegExp(markerLine)}$`, 'm');
  if (!markerPattern.test(content)) {
    fail(`${filePath}: missing generation marker ${markerLine}`);
  }
}

function verifyPoliteInterventionOpenapiAnnotations() {
  const content = readFileSync(OPENAPI_FILE, 'utf8');
  const lines = content.split(/\r?\n/);
  let currentPath = null;
  let currentMethod = null;
  let currentFields = new Set();

  function flushCurrentOperation() {
    if (!currentPath || !currentMethod) {
      return;
    }

    const missing = REQUIRED_PI_OPERATION_KEYS.filter((key) => !currentFields.has(key));
    if (missing.length > 0) {
      fail(`${OPENAPI_FILE}: ${currentMethod.toUpperCase()} ${currentPath} is missing ${missing.join(', ')}`);
    }
  }

  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) {
      flushCurrentOperation();
      currentPath = pathMatch[1];
      currentMethod = null;
      currentFields = new Set();
      continue;
    }

    const methodMatch = line.match(/^    (get|post|put|patch|delete|head|options|trace):\s*$/);
    if (methodMatch) {
      flushCurrentOperation();
      currentMethod = methodMatch[1];
      currentFields = new Set();
      continue;
    }

    if (!currentMethod) {
      continue;
    }

    const fieldMatch = line.match(/^      ([A-Za-z0-9_.-]+):/);
    if (fieldMatch) {
      currentFields.add(fieldMatch[1]);
    }
  }

  flushCurrentOperation();
}

assertMarker(OPENAPI_FILE, 'x-generated-by: cursor');
console.log('openapi: non-enforceable - requires future automation (no deterministic regeneration command is defined in this repository)');

const decisionProcedureFiles = listYamlFiles(DECISION_PROCEDURES_DIR);
if (decisionProcedureFiles.length > 0) {
  for (const filePath of decisionProcedureFiles) {
    assertMarker(filePath, 'generated_by: cursor');
  }
  console.log('decision_procedures: non-enforceable - requires future automation (no deterministic regeneration command is defined in this repository)');
}

const dataModelFiles = listYamlFiles(DATA_MODEL_DIR);
if (dataModelFiles.length > 0) {
  for (const filePath of dataModelFiles) {
    assertMarker(filePath, 'generated_by: cursor');
  }
  console.log('data_model: non-enforceable - requires future automation (no deterministic regeneration command is defined in this repository)');
}

if (serviceName === 'polite-intervention') {
  verifyPoliteInterventionOpenapiAnnotations();
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
