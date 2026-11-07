// Integration tests for the CLI itself (failure paths), using node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist/cli/index.js");

function lithe(...args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("exits 1 and reports each kind of failure", () => {
  const { code, out } = lithe("test/fixtures/failing.fixture.ts");
  assert.equal(code, 1);
  assert.match(out, /✓ passes/);
  assert.match(out, /Expected: \{ answer: 'Lyon' \}/);
  assert.match(out, /timed out after 50ms/);
  assert.match(out, /✗ unhandled rejection is attributed to the test[\s\S]*escaped/);
  assert.match(out, /broken setup › never runs its body[\s\S]*db down/);
  assert.match(out, /4 failed, 1 passed/);
});

test("exits 0 when everything passes", () => {
  const { code, out } = lithe("examples");
  assert.equal(code, 0, out);
  assert.match(out, /Test files: 2 passed/);
});

test(".only skips the other tests in the file", () => {
  const { code, out } = lithe("test/fixtures/only.fixture.ts");
  assert.equal(code, 0, out);
  assert.match(out, /○ not this one/);
});

test("--test-name-pattern filters tests", () => {
  const { code, out } = lithe("examples", "-t", "runaway");
  assert.equal(code, 0, out);
  assert.match(out, /1 passed, 4 skipped/);
});

test("reports files that fail to load", () => {
  const { code, out } = lithe("test/fixtures/syntax-error.fixture.ts");
  assert.equal(code, 1);
  assert.match(out, /failed to load test file/);
});

test("runs ESM test files", () => {
  const { code, out } = lithe("test/fixtures/esm.fixture.mjs");
  assert.equal(code, 0, out);
});

test("path patterns filter discovered files", () => {
  const { out } = lithe("--list", "mock");
  assert.equal(out.trim().split("\n").length, 1);
  assert.match(out, /test\/mock\.test\.ts/);
});

test("exits 1 when no test files are found", () => {
  const { code, out } = lithe("does-not-exist-anywhere");
  assert.equal(code, 1);
  assert.match(out, /No test files found/);
});
