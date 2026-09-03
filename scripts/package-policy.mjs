export const requiredPackageFiles = Object.freeze([
  "dist/src/cli/bin.js",
  "dist/src/server/static-web.js",
  "dist/schema/v1/project.schema.json",
  "dist/web/index.html",
  "templates/chronicle/AGENTS.md",
  "templates/chronicle/.gitattributes",
  "docs/schema/v1-public-contract.md",
  "docs/usability/orientation-study.md",
  "README.md",
  "package.json",
]);

const allowedDocumentationFiles = new Set([
  "docs/schema/v1-public-contract.md",
  "docs/usability/orientation-study.md",
]);

export function inspectPackageFiles(files) {
  const paths = files.map((entry) => typeof entry === "string" ? entry : entry.path);
  const missing = requiredPackageFiles.filter((required) => !paths.includes(required));
  const forbidden = paths.filter((file) =>
    /^(?:src|tests|examples|scripts|test-results|dev|chronicle)\//u.test(file) ||
    (file.startsWith("docs/") && !allowedDocumentationFiles.has(file)) ||
    file.startsWith("dist/tests/"));

  return { missing, forbidden };
}

export function assertPackageFiles(files) {
  const { missing, forbidden } = inspectPackageFiles(files);
  if (missing.length > 0) {
    throw new Error(`package is missing required files: ${missing.join(", ")}`);
  }
  if (forbidden.length > 0) {
    throw new Error(`package contains forbidden files: ${forbidden.join(", ")}`);
  }
}
