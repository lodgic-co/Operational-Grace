#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const governanceRoot = path.join(repoRoot, "scripts", "validation", "platform-rules");
const entrypoint = "index.yaml";
const listKeys = new Set(["files", "includes"]);

function toPosix(value) {
  return value.split(path.sep).join(path.posix.sep);
}

function fromGovernanceRoot(absolutePath) {
  return toPosix(path.relative(governanceRoot, absolutePath));
}

function governanceAbsolute(relativePath) {
  return path.join(governanceRoot, relativePath);
}

function fileExists(relativePath) {
  try {
    return statSync(governanceAbsolute(relativePath)).isFile();
  } catch {
    return false;
  }
}

function isIndexFile(relativePath) {
  return path.posix.basename(relativePath) === "index.yaml";
}

function walkYamlFiles(directoryAbsolute, results = []) {
  for (const entry of readdirSync(directoryAbsolute, { withFileTypes: true })) {
    const absolutePath = path.join(directoryAbsolute, entry.name);
    if (entry.isDirectory()) {
      walkYamlFiles(absolutePath, results);
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith(".yaml")) {
      results.push(fromGovernanceRoot(absolutePath));
    }
  }
  return results.sort();
}

function parseIndexLists(relativePath) {
  const content = readFileSync(governanceAbsolute(relativePath), "utf8");
  const lines = content.split(/\r?\n/);
  const lists = new Map();
  let currentKey = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const topLevelKeyMatch = rawLine.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (topLevelKeyMatch) {
      const candidateKey = topLevelKeyMatch[1];
      currentKey = listKeys.has(candidateKey) ? candidateKey : null;
      if (currentKey && !lists.has(currentKey)) {
        lists.set(currentKey, []);
      }
      continue;
    }

    if (!currentKey) {
      continue;
    }

    const itemMatch = rawLine.match(/^  -\s+(.+?)\s*$/);
    if (!itemMatch) {
      continue;
    }

    const value = itemMatch[1].replace(/^["']|["']$/g, "");
    lists.get(currentKey).push(value);
  }

  return lists;
}

function resolveReference(indexPath, value) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(indexPath), value));
}

function createErrorStore() {
  return new Map([
    ["BROKEN_REFERENCE", []],
    ["DUPLICATE_LOAD_PATH", []],
    ["UNREACHABLE_GOVERNANCE_FILE", []],
  ]);
}

function addError(errors, type, file, reason) {
  errors.get(type).push({ file, reason });
}

function validateIndexReferences(indexFiles, errors) {
  const resolvedReferences = new Map();

  for (const indexFile of indexFiles) {
    const lists = parseIndexLists(indexFile);
    const references = [];

    for (const values of lists.values()) {
      for (const value of values) {
        const target = resolveReference(indexFile, value);
        references.push(target);
        if (!fileExists(target)) {
          addError(errors, "BROKEN_REFERENCE", indexFile, `${value} resolves to missing file ${target}`);
        }
      }
    }

    resolvedReferences.set(indexFile, references);
  }

  return resolvedReferences;
}

function recordLoad(loadMap, file, trail) {
  if (!loadMap.has(file)) {
    loadMap.set(file, new Set());
  }
  loadMap.get(file).add(trail.join(" -> "));
}

function traverse(file, trail, resolvedReferences, loads, stack = new Set()) {
  if (!fileExists(file)) {
    return;
  }

  recordLoad(loads, file, trail);
  if (stack.has(file) || !isIndexFile(file)) {
    return;
  }

  const nextStack = new Set(stack);
  nextStack.add(file);
  for (const target of resolvedReferences.get(file) ?? []) {
    if (!fileExists(target)) {
      continue;
    }
    traverse(target, [...trail, target], resolvedReferences, loads, nextStack);
  }
}

function reportDuplicateLoads(loads, errors) {
  for (const [file, trails] of loads.entries()) {
    if (trails.size > 1) {
      addError(errors, "DUPLICATE_LOAD_PATH", file, `loaded via multiple index paths: ${[...trails].join(" | ")}`);
    }
  }
}

function reportUnreachableFiles(allYamlFiles, loads, errors) {
  for (const file of allYamlFiles) {
    if (!loads.has(file)) {
      addError(errors, "UNREACHABLE_GOVERNANCE_FILE", file, "file is not reachable from scripts/validation/platform-rules/index.yaml");
    }
  }
}

function printReport(errors, allYamlFiles, loads) {
  const totalErrors = [...errors.values()].reduce((sum, entries) => sum + entries.length, 0);
  console.log("Governance entrypoint validation");
  console.log(`Entrypoint: scripts/validation/platform-rules/${entrypoint}`);
  console.log(`Discovered YAML files: ${allYamlFiles.length}`);
  console.log(`Active reachable files: ${loads.size}`);
  if (totalErrors === 0) {
    console.log("Result: OK");
    console.log("Errors: 0");
    return;
  }
  console.log("Result: FAIL");
  console.log(`Errors: ${totalErrors}`);
  for (const [type, entries] of errors.entries()) {
    if (entries.length === 0) {
      continue;
    }
    console.log(`\n${type} (${entries.length})`);
    for (const entry of entries) {
      console.log(`- file: scripts/validation/platform-rules/${entry.file}`);
      console.log(`  reason: ${entry.reason}`);
    }
  }
}

const allYamlFiles = walkYamlFiles(governanceRoot);
const indexFiles = allYamlFiles.filter(isIndexFile);
const errors = createErrorStore();
const resolvedReferences = validateIndexReferences(indexFiles, errors);
const loads = new Map();
traverse(entrypoint, [entrypoint], resolvedReferences, loads);
reportDuplicateLoads(loads, errors);
reportUnreachableFiles(allYamlFiles, loads, errors);
printReport(errors, allYamlFiles, loads);

const totalErrors = [...errors.values()].reduce((sum, entries) => sum + entries.length, 0);
if (totalErrors > 0) {
  process.exit(1);
}
