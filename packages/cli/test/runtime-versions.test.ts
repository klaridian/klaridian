// packages/cli/test/runtime-versions.test.ts
//
// MCPFO-121: the Node/Python versions a generated server declares all come
// from src/emit/runtime-versions.ts. These tests read the REAL emitted files
// and require every surface that names a runtime version to agree with those
// constants, so a floor bump can't update one file and silently miss another.
// The CI matrix (Node floor+current, Python floor+current) is what makes the
// declared floors true, not just consistent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { emitPackageJson } from "../src/emit/emit-project-files.js";
import { emitPythonProject } from "../src/emit/python/emit-python.js";
import { emitDockerArtifacts } from "../src/emit/deploy/emit-docker.js";
import {
  NODE_FLOOR_MAJOR,
  NODE_DOCKER_IMAGE,
  PYTHON_FLOOR,
  PYTHON_DOCKER_IMAGE,
} from "../src/emit/runtime-versions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

test("TS project: engines, esbuild target and @types/node all track NODE_FLOOR_MAJOR", () => {
  const pkg = JSON.parse(emitPackageJson("petstore", "stdio", {}));
  assert.equal(pkg.engines.node, `>=${NODE_FLOOR_MAJOR}`);
  assert.match(pkg.scripts.bundle, new RegExp(`--target=node${NODE_FLOOR_MAJOR}\\b`));
  assert.equal(pkg.devDependencies["@types/node"], `^${NODE_FLOOR_MAJOR}.0.0`);
});

test("Python project: requires-python is PYTHON_FLOOR", () => {
  const files = emitPythonProject({ serverName: "petstore", tools: [], baseUrl: "https://api.example.com", transport: "stdio" });
  assert.match(files["pyproject.toml"]!, new RegExp(`^requires-python = ">=${PYTHON_FLOOR.replace(".", "\\.")}"$`, "m"));
});

test("Docker images satisfy the declared floors", () => {
  const ts = emitDockerArtifacts({ language: "typescript", port: 3000 })["Dockerfile"];
  const py = emitDockerArtifacts({ language: "python", port: 3000 })["Dockerfile"];
  assert.ok(ts.includes(`FROM ${NODE_DOCKER_IMAGE} AS runtime`));
  assert.ok(py.includes(`FROM ${PYTHON_DOCKER_IMAGE} AS runtime`));
  const nodeImageMajor = Number(/node:(\d+)/.exec(NODE_DOCKER_IMAGE)![1]);
  assert.ok(nodeImageMajor >= NODE_FLOOR_MAJOR, "Docker Node >= engines floor");
  const [pyMaj, pyMin] = /python:(\d+)\.(\d+)/.exec(PYTHON_DOCKER_IMAGE)!.slice(1).map(Number);
  const [floorMaj, floorMin] = PYTHON_FLOOR.split(".").map(Number);
  assert.ok(pyMaj > floorMaj || (pyMaj === floorMaj && pyMin >= floorMin), "Docker Python >= requires-python floor");
});

test("CI runs the E2E suite on each declared floor (a floor CI never runs is an untested promise)", async () => {
  const ci = await readFile(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, new RegExp(`node: ?"${NODE_FLOOR_MAJOR}"`), `ci.yml matrix includes Node ${NODE_FLOOR_MAJOR}`);
  assert.match(ci, new RegExp(`python: ?"${PYTHON_FLOOR.replace(".", "\\.")}"`), `ci.yml matrix includes Python ${PYTHON_FLOOR}`);
});

test("docs state the same floors the emitter declares", async () => {
  const doc = await readFile(
    path.join(REPO_ROOT, "packages", "site", "content", "docs", "how-to", "target-language.mdx"),
    "utf8",
  );
  assert.ok(doc.includes(`Node.js ${NODE_FLOOR_MAJOR} or later`), "target-language.mdx names the Node floor");
  assert.ok(doc.includes(`Python ${PYTHON_FLOOR} or later`), "target-language.mdx names the Python floor");
  const deployDoc = await readFile(
    path.join(REPO_ROOT, "packages", "site", "content", "docs", "how-to", "deploy.mdx"),
    "utf8",
  );
  for (const [name, text] of [["target-language.mdx", doc], ["deploy.mdx", deployDoc]] as const) {
    assert.ok(text.includes(`\`${NODE_DOCKER_IMAGE}\``), `${name} names the real Node Docker image`);
    assert.ok(text.includes(`\`${PYTHON_DOCKER_IMAGE}\``), `${name} names the real Python Docker image`);
  }
});
