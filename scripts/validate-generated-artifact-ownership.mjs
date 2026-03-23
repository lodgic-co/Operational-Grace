#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const serviceName = packageJson.name;
const baselinePath = path.join(repoRoot, "scripts", "validation", "generated-artifact-peer-baseline.json");
const governanceRoot = path.join(repoRoot, "scripts", "validation", "platform-rules");
const errorTypes = [
  "DUPLICATE_DECISION_PROCEDURE_NAME",
  "UNAUTHORISED_SHARED_DATA_MODEL",
  "OPENAPI_GOVERNANCE_VIOLATION",
];
const httpMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

function statSafe(targetPath) {
  try {
    return statSync(targetPath);
  } catch {
    return null;
  }
}

function walkYamlFiles(directoryAbsolute, results = []) {
  if (!statSafe(directoryAbsolute)?.isDirectory()) {
    return results;
  }
  for (const entry of readdirSync(directoryAbsolute, { withFileTypes: true })) {
    const absolutePath = path.join(directoryAbsolute, entry.name);
    if (entry.isDirectory()) {
      walkYamlFiles(absolutePath, results);
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith(".yaml")) {
      results.push(absolutePath);
    }
  }
  return results.sort();
}

function createErrorStore() {
  return new Map(errorTypes.map((type) => [type, []]));
}

function addError(errors, type, filename, services, reason) {
  errors.get(type).push({ filename, services: [...new Set(services)].sort(), reason });
}

function readSimpleList(filePath, key) {
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const values = [];
  let active = false;
  for (const line of lines) {
    if (new RegExp(`^${key}:\\s*$`).test(line)) {
      active = true;
      continue;
    }
    if (!active) {
      continue;
    }
    if (/^[A-Za-z0-9_-]+:\s*$/.test(line)) {
      break;
    }
    const match = line.match(/^  -\s+(.+?)\s*$/);
    if (match) {
      values.push(match[1].replace(/^["']|["']$/g, ""));
    }
  }
  return values;
}

function readSimpleScalar(filePath, key) {
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`^${key}:\\s+(.+?)\\s*$`));
    if (match) {
      return match[1].replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

function basenameWithoutExtension(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function loadBaseline() {
  return JSON.parse(readFileSync(baselinePath, "utf8"));
}

function validateDecisionProcedureOwnership(errors, baseline) {
  const localNames = walkYamlFiles(path.join(repoRoot, "decision-procedures", "generated")).map(basenameWithoutExtension);
  for (const localName of localNames) {
    for (const [peerService, peerData] of Object.entries(baseline.services)) {
      if (peerService === serviceName) {
        continue;
      }
      if (peerData.decision_procedures.includes(localName)) {
        addError(
          errors,
          "DUPLICATE_DECISION_PROCEDURE_NAME",
          `${localName}.yaml`,
          [serviceName, peerService],
          "decision procedure filename must be globally unique across services",
        );
      }
    }
  }
  return localNames.length;
}

function validateDataModelSharing(errors, baseline, allowlist) {
  const localNames = walkYamlFiles(path.join(repoRoot, "data-model", "generated")).map(basenameWithoutExtension);
  for (const localName of localNames) {
    for (const [peerService, peerData] of Object.entries(baseline.services)) {
      if (peerService === serviceName) {
        continue;
      }
      if (!peerData.data_models.includes(localName)) {
        continue;
      }
      if (allowlist.has(localName)) {
        continue;
      }
      addError(
        errors,
        "UNAUTHORISED_SHARED_DATA_MODEL",
        `${localName}.yaml`,
        [serviceName, peerService],
        "shared data model filename is not explicitly allowlisted",
      );
    }
  }
  return localNames.length;
}

function validateOpenApiGovernance(errors, requiredKeys, allowedAuthModes, requiredPublicSurfaceValue) {
  const openapiFile = path.join(repoRoot, "openapi", "openapi.yaml");
  const lines = readFileSync(openapiFile, "utf8").split(/\r?\n/);
  let currentPath = null;
  let currentMethod = null;
  let currentFields = new Map();
  let operations = 0;

  function flushOperation() {
    if (!currentPath || !currentMethod) {
      return;
    }
    operations += 1;
    for (const key of requiredKeys) {
      if (!currentFields.has(key)) {
        addError(errors, "OPENAPI_GOVERNANCE_VIOLATION", "openapi/openapi.yaml", [serviceName], `${currentMethod.toUpperCase()} ${currentPath} is missing ${key}`);
      }
    }
    const authMode = currentFields.get("x-auth-mode");
    if (authMode && !allowedAuthModes.has(authMode)) {
      addError(errors, "OPENAPI_GOVERNANCE_VIOLATION", "openapi/openapi.yaml", [serviceName], `${currentMethod.toUpperCase()} ${currentPath} uses unsupported x-auth-mode ${authMode}`);
    }
    const publicSurface = currentFields.get("x-public-surface");
    if (publicSurface !== undefined && publicSurface !== requiredPublicSurfaceValue) {
      addError(errors, "OPENAPI_GOVERNANCE_VIOLATION", "openapi/openapi.yaml", [serviceName], `${currentMethod.toUpperCase()} ${currentPath} must set x-public-surface to ${requiredPublicSurfaceValue}`);
    }
  }

  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) {
      flushOperation();
      currentPath = pathMatch[1];
      currentMethod = null;
      currentFields = new Map();
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete|head|options|trace):\s*$/);
    if (methodMatch) {
      flushOperation();
      currentMethod = methodMatch[1];
      currentFields = new Map();
      continue;
    }
    if (!currentMethod || !httpMethods.has(currentMethod)) {
      continue;
    }
    const fieldMatch = line.match(/^      ([A-Za-z0-9_.-]+):\s*(.+?)?\s*$/);
    if (fieldMatch) {
      const key = fieldMatch[1];
      const raw = (fieldMatch[2] ?? "").trim();
      let value = raw;
      if (raw === "true") {
        value = true;
      }
      if (raw === "false") {
        value = false;
      }
      currentFields.set(key, value);
    }
  }
  flushOperation();
  return operations;
}

function printReport(errors, decisionCount, dataModelCount, operationsCount) {
  const totalErrors = [...errors.values()].reduce((sum, entries) => sum + entries.length, 0);
  console.log("Generated artifact ownership validation");
  console.log(`Service scanned: ${serviceName}`);
  console.log(`Decision procedure files scanned: ${decisionCount}`);
  console.log(`Data model files scanned: ${dataModelCount}`);
  console.log(`OpenAPI operations scanned: ${operationsCount}`);
  if (totalErrors === 0) {
    console.log("Result: OK");
    console.log("Errors: 0");
    return;
  }
  console.log("Result: FAIL");
  console.log(`Errors: ${totalErrors}`);
  for (const type of errorTypes) {
    const entries = errors.get(type) ?? [];
    if (entries.length === 0) {
      continue;
    }
    console.log(`\n${type} (${entries.length})`);
    for (const entry of entries) {
      console.log(`- filename: ${entry.filename}`);
      console.log(`  services: ${entry.services.join(", ")}`);
      console.log(`  reason: ${entry.reason}`);
    }
  }
}

const errors = createErrorStore();
const baseline = loadBaseline();
const allowlist = new Set(readSimpleList(path.join(governanceRoot, "contracts", "shared-generated-model-allowlist.yaml"), "shared_data_models"));
const requiredKeys = readSimpleList(path.join(governanceRoot, "authority", "openapi-generation-model.yaml"), "required_endpoint_metadata");
const allowedAuthModes = new Set(readSimpleList(path.join(governanceRoot, "authority", "openapi-generation-model.yaml"), "allowed_x_auth_mode_values"));
const requiredPublicSurfaceValue = readSimpleScalar(path.join(governanceRoot, "authority", "openapi-generation-model.yaml"), "required_x_public_surface_value") === "false" ? false : true;
const decisionCount = validateDecisionProcedureOwnership(errors, baseline);
const dataModelCount = validateDataModelSharing(errors, baseline, allowlist);
const operationsCount = validateOpenApiGovernance(errors, requiredKeys, allowedAuthModes, requiredPublicSurfaceValue);
printReport(errors, decisionCount, dataModelCount, operationsCount);
const totalErrors = [...errors.values()].reduce((sum, entries) => sum + entries.length, 0);
if (totalErrors > 0) {
  process.exit(1);
}
