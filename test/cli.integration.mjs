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
  assert.match(out, /Test files: \d+ passed \(\d+\)/);
  assert.doesNotMatch(out, /failed/);
});

test(".only skips the other tests in the file", () => {
  const { code, out } = lithe("test/fixtures/only.fixture.ts");
  assert.equal(code, 0, out);
  assert.match(out, /○ not this one/);
});

test("--test-name-pattern filters tests", () => {
  const { code, out } = lithe("examples", "-t", "runaway");
  assert.equal(code, 0, out);
  assert.match(out, /Tests: +1 passed, \d+ skipped/);
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

import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

function litheEnv(env, ...args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("failing tests print their trace", () => {
  const { code, out } = litheEnv({ AGENT_VARIANT: "v2" }, "test/fixtures/agent-trace.fixture.ts");
  assert.equal(code, 1);
  assert.match(out, /Trace \(2 steps\):/);
  assert.match(out, /note: chose search query \{"query":"Chicago restaurants","variant":"v2"\}/);
  assert.match(out, /search\("Chicago restaurants"\) → \["Top pick for \\"Chicago restaurants\\""\]/);
});

test("--report writes a JSON record and compare explains what changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "lithe-"));
  const before = join(dir, "before.json");
  const after = join(dir, "nested", "after.json");

  assert.equal(litheEnv({ AGENT_VARIANT: "v1" }, "test/fixtures/agent-trace.fixture.ts", "--report", before).code, 0);
  assert.equal(litheEnv({ AGENT_VARIANT: "v2" }, "test/fixtures/agent-trace.fixture.ts", "--report", after).code, 1);

  const report = JSON.parse(readFileSync(before, "utf8"));
  assert.equal(report.schema, 1);
  assert.equal(report.summary.pass, 2);
  assert.ok(report.git?.commit, "records the git commit");
  const t = report.tests.find((x) => x.name.at(-1) === "plans a trip");
  assert.equal(t.id, "test/fixtures/agent-trace.fixture.ts > plans a trip");
  assert.deepEqual(t.trace.map((e) => [e.type, e.name]), [["note", "chose search query"], ["call", "search"]]);

  const same = lithe("compare", before, before);
  assert.equal(same.code, 0);
  assert.match(same.out, /No changes/);

  const diff = lithe("compare", before, after);
  assert.equal(diff.code, 1, diff.out);
  assert.match(diff.out, /✗ now failing {2}test\/fixtures\/agent-trace\.fixture\.ts > plans a trip \(pass → fail\)/);
  assert.match(diff.out, /first difference at step 1:/);
  assert.match(diff.out, /- note: chose search query \{"query":"things to do in Chicago","variant":"v1"\}/);
  assert.match(diff.out, /\+ note: chose search query \{"query":"Chicago restaurants","variant":"v2"\}/);
  assert.match(diff.out, /error: expect\(received\)\.toContain\(expected\)/);
  assert.doesNotMatch(diff.out, /unchanged test/);

  const fixed = lithe("compare", after, before);
  assert.equal(fixed.code, 0);
  assert.match(fixed.out, /✓ now passing/);
});

test("compare rejects files that are not reports", () => {
  const { code, out } = lithe("compare", "package.json", "package.json");
  assert.equal(code, 2);
  assert.match(out, /not a lithe report/);
});

test("--setup configures a judge for semantic assertions", () => {
  const { code, out } = lithe("test/fixtures/semantic.fixture.ts", "--setup", "test/fixtures/judge.setup.ts");
  assert.equal(code, 1, out);
  assert.match(out, /✓ awaited semantic assertion passes/);
  assert.match(out, /✗ un-awaited failing assertion still fails the test[\s\S]*Judge: never mentions friday[\s\S]*This assertion was not awaited/);
  assert.match(out, /✗ judge calls appear in the trace[\s\S]*Trace \(1 step\):[\s\S]*judge\("You are grading/);
  assert.match(out, /2 failed, 1 passed/);
});

test("semantic assertions without a judge explain how to configure one", () => {
  const { code, out } = lithe("test/fixtures/semantic.fixture.ts", "-t", "awaited semantic");
  assert.equal(code, 1);
  assert.match(out, /toMean needs a judge\. Call configure\(\{ judge \}\)/);
});

test("a broken setup file stops the run", () => {
  const { code, out } = lithe("examples/basic.test.ts", "--setup", "test/fixtures/syntax-error.fixture.ts");
  assert.equal(code, 1);
  assert.match(out, /Setup file .* failed to load/);
});
