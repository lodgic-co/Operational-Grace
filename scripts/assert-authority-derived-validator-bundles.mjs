// Authority-derived validator bundles are synced from lodgic/scripts/validator-source.
// Do not edit these bundled files directly as part of feature work.
// Valid changes come from updating authority in lodgic,
// running validator sync, and committing the synced result.
// Sync-only diffs are allowed.
// Root reconcile remains the final cross-repo integrity check.

import { execFileSync } from "node:child_process";

const PROTECTED_PATHS = [
  "scripts/validation/generated-artifact-peer-baseline.json",
  "scripts/validate-generated-artifact-ownership.mjs",
  "scripts/validate-governance-entrypoint.mjs",
  "scripts/validation/platform-rules/",
];

const FAILURE_MESSAGE =
  "This file is authority-derived from lodgic validator-source. Do not edit it directly in the service repo. Update the authoritative source in lodgic, run the validator sync, and commit the synced result.";

function runGit(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function isProtectedPath(filePath) {
  return PROTECTED_PATHS.some((protectedPath) =>
    protectedPath.endsWith("/")
      ? filePath.startsWith(protectedPath)
      : filePath === protectedPath,
  );
}

function resolveBaseRef() {
  try {
    runGit(["rev-parse", "--verify", "origin/main"]);
    return "origin/main";
  } catch {
    return null;
  }
}

const baseRef = resolveBaseRef();

if (!baseRef) {
  const guidance =
    "Authority-derived validator bundle guard could not resolve origin/main. Ensure CI checkout fetches base history (for GitHub Actions use actions/checkout with fetch-depth: 0).";

  if (process.env.GITHUB_ACTIONS === "true") {
    console.error(guidance);
    process.exit(1);
  }

  console.warn(guidance);
  process.exit(0);
}

const mergeBase = runGit(["merge-base", baseRef, "HEAD"]);
const changedFilesOutput = runGit([
  "diff",
  "--name-only",
  "--diff-filter=ACMR",
  `${mergeBase}..HEAD`,
]);
const changedFiles = changedFilesOutput
  ? changedFilesOutput.split(/\r?\n/).filter(Boolean)
  : [];
const protectedChangedFiles = changedFiles.filter(isProtectedPath);

if (protectedChangedFiles.length === 0) {
  process.exit(0);
}

const nonProtectedChangedFiles = changedFiles.filter(
  (filePath) => !isProtectedPath(filePath),
);

if (nonProtectedChangedFiles.length === 0) {
  console.log(
    "Authority-derived validator bundle guard: protected files changed in a sync-only diff. Ensure the update came from lodgic authority plus validator sync.",
  );
  process.exit(0);
}

console.error("Authority-derived validator bundle guard failed.");
console.error("");
console.error(FAILURE_MESSAGE);
console.error("");
console.error("Protected files changed in this mixed diff:");
for (const filePath of protectedChangedFiles) {
  console.error(`- ${filePath}`);
}
console.error("");
console.error("Other files changed in the same diff:");
for (const filePath of nonProtectedChangedFiles) {
  console.error(`- ${filePath}`);
}
console.error("");
console.error(
  "If this was an intentional authority sync, land the bundled validator update in a dedicated sync-only service PR.",
);
process.exit(1);
