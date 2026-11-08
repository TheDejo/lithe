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

// ---------------------------------------------------------------------------
// Record & replay, JUnit, watch mode. These run in temp folders so recordings
// and reports never land in the repo.
// ---------------------------------------------------------------------------
import { writeFileSync, existsSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const litheUrl = pathToFileURL(join(root, "dist/index.js")).href;

function tempProject(files) {
  const dir = mkdtempSync(join(tmpdir(), "lithe-proj-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function litheIn(dir, ...args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("record once, then replay without calling the real function", () => {
  const dir = tempProject({});
  const calls = join(dir, "calls.log");
  const testFile = (city) => `
    import { test, expect, recorded } from ${JSON.stringify(litheUrl)};
    import { appendFileSync } from "node:fs";
    const weather = recorded("weather", async (city) => {
      appendFileSync(${JSON.stringify(calls)}, city + "\\n");
      return { city, forecast: "sunny" };
    });
    test("asks for the weather", async () => {
      expect(await weather(${JSON.stringify(city)})).toEqual({ city: ${JSON.stringify(city)}, forecast: "sunny" });
    });`;
  writeFileSync(join(dir, "weather.test.mjs"), testFile("Chicago"));
  const callCount = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0);

  let r = litheIn(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /No recording for weather\("Chicago"\)[\s\S]*Run once with --record/);
  assert.equal(callCount(), 0);

  r = litheIn(dir, "--record");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Saved recordings to __recordings__\/weather\.test\.mjs\.json/);
  assert.equal(callCount(), 1);
  const saved = JSON.parse(readFileSync(join(dir, "__recordings__/weather.test.mjs.json"), "utf8"));
  assert.deepEqual(saved.tests["asks for the weather"][0].result, { city: "Chicago", forecast: "sunny" });

  r = litheIn(dir);
  assert.equal(r.code, 0, r.out);
  assert.equal(callCount(), 1, "replay must not call the real function");

  writeFileSync(join(dir, "weather.test.mjs"), testFile("Boston"));
  r = litheIn(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /No recording for weather\("Boston"\)/);

  r = litheIn(dir, "--rerecord");
  assert.equal(r.code, 0, r.out);
  assert.equal(callCount(), 2);
  const resaved = JSON.parse(readFileSync(join(dir, "__recordings__/weather.test.mjs.json"), "utf8"));
  assert.equal(resaved.tests["asks for the weather"].length, 1, "rerecord replaces the old entries");
  assert.equal(resaved.tests["asks for the weather"][0].args[0], "Boston");
  rmSync(dir, { recursive: true, force: true });
});

test("--junit writes a JUnit XML report", () => {
  const out = join(mkdtempSync(join(tmpdir(), "lithe-junit-")), "nested", "junit.xml");
  const { code } = lithe("test/fixtures/failing.fixture.ts", "test/fixtures/only.fixture.ts", "--junit", out);
  assert.equal(code, 1);
  const xml = readFileSync(out, "utf8");
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<testsuites name="lithe" tests="7" failures="4" errors="0" skipped="1"/);
  assert.match(xml, /<testsuite name="test\/fixtures\/failing\.fixture\.ts" tests="5" failures="4"/);
  assert.match(xml, /<testcase classname="test\/fixtures\/failing\.fixture\.ts" name="passes" time="[\d.]+" \/>/);
  assert.match(xml, /name="broken setup › never runs its body"[\s\S]*?<failure message="db down" type="Error">/);
  assert.match(xml, /<failure message="expect\(received\)\.toEqual\(expected\)" type="AssertionError">/);
  assert.match(xml, /name="not this one"[^>]*>\s*<skipped message="skipped" \/>/);
  assert.doesNotMatch(xml, /\x1b\[/, "no colour codes in XML");
});

test("--junit includes the trace of a failing test", () => {
  const out = join(mkdtempSync(join(tmpdir(), "lithe-junit-")), "junit.xml");
  litheEnv({ AGENT_VARIANT: "v2" }, "test/fixtures/agent-trace.fixture.ts", "--junit", out);
  const xml = readFileSync(out, "utf8");
  assert.match(xml, /<system-out>Trace \(2 steps\):\n1\. \+\d+ms note: chose search query \{&quot;query&quot;:&quot;Chicago restaurants&quot;,&quot;variant&quot;:&quot;v2&quot;\}\n2\. \+\d+ms search\(/);
});

test("--watch re-runs the tests when a file changes", async () => {
  const dir = tempProject({
    "math.test.mjs": `import { test, expect } from ${JSON.stringify(litheUrl)};\ntest("adds", () => expect(1 + 1).toBe(2));\n`,
  });
  const child = spawn(process.execPath, [cli, "--watch"], { cwd: dir, env: { ...process.env, NO_COLOR: "1" } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const waitFor = (re, ms = 8000) =>
    new Promise((ok, fail) => {
      const start = Date.now();
      const tick = () => (re.test(out) ? ok() : Date.now() - start > ms ? fail(new Error(`Timed out waiting for ${re}. Output:\n${out}`)) : setTimeout(tick, 50));
      tick();
    });
  try {
    await waitFor(/Passed\. Watching for changes/);
    writeFileSync(join(dir, "math.test.mjs"), `import { test, expect } from ${JSON.stringify(litheUrl)};\ntest("adds", () => expect(1 + 1).toBe(3));\n`);
    await waitFor(/Changed: math\.test\.mjs[\s\S]*✗ adds[\s\S]*Failed\. Watching for changes/);
  } finally {
    child.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--record and --rerecord cannot be combined", () => {
  const { code, out } = lithe("examples/basic.test.ts", "--record", "--rerecord");
  assert.equal(code, 1);
  assert.match(out, /either --record or --rerecord/);
});

test("replay keeps call order, replays errors, and ignores object key order", () => {
  const dir = tempProject({});
  const write = (keyOrder) => writeFileSync(join(dir, "edge.test.mjs"), `
    import { test, expect, recorded } from ${JSON.stringify(litheUrl)};
    let n = 0;
    const next = recorded("next", async () => ++n);
    const lookup = recorded("lookup", async (q) => { if (q.id === "missing") throw new TypeError("not found"); return q.id; });
    test("same call twice gets each answer in order", async () => {
      expect(await next()).toBe(1);
      expect(await next()).toBe(2);
    });
    test("errors are replayed as errors", async () => {
      await expect(lookup({ id: "missing" })).rejects.toThrow("not found");
    });
    test("object key order does not matter", async () => {
      expect(await lookup(${keyOrder})).toBe("a");
    });
    const outside = recorded("outside", async () => "called for real");
    console.log("outside:", await outside());`);

  write(`{ id: "a", kind: "x" }`);
  assert.equal(litheIn(dir, "--record").code, 0);
  write(`{ kind: "x", id: "a" }`);
  const r = litheIn(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /outside: called for real/);
  const saved = JSON.parse(readFileSync(join(dir, "__recordings__/edge.test.mjs.json"), "utf8"));
  assert.deepEqual(saved.tests["errors are replayed as errors"][0].error, { name: "TypeError", message: "not found" });
  assert.equal(Object.keys(saved.tests).some((t) => saved.tests[t].some((e) => e.call === "outside")), false);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Parallel file execution
// ---------------------------------------------------------------------------

test("--jobs gives the same results as a serial run", () => {
  const serial = lithe("examples", "test");
  const parallel = lithe("examples", "test", "--jobs", "4");
  assert.equal(serial.code, 0, serial.out);
  assert.equal(parallel.code, 0, parallel.out);
  const summary = (out) => out.match(/Test files:.*\n.*Tests:.*/)[0];
  assert.equal(summary(parallel.out), summary(serial.out));
});

test("--jobs reports failures once, with traces, and combines --report and --junit", () => {
  const dir = mkdtempSync(join(tmpdir(), "lithe-par-"));
  const { code, out } = litheEnv(
    { AGENT_VARIANT: "v2" },
    "test/fixtures/failing.fixture.ts", "test/fixtures/agent-trace.fixture.ts", "test/fixtures/only.fixture.ts",
    "--jobs", "3", "--report", join(dir, "run.json"), "--junit", join(dir, "junit.xml")
  );
  assert.equal(code, 1);
  assert.match(out, /Failures \(5\):/);
  assert.equal(out.match(/db down/g).length >= 1, true);
  assert.match(out, /plans a trip[\s\S]*Trace \(2 steps\)/);
  assert.match(out, /Test files: 2 failed, 1 passed \(3\)/);
  assert.match(out, /Tests: +5 failed, 3 passed, 1 skipped \(9\)/);
  const report = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  assert.equal(report.summary.total, 9);
  assert.deepEqual([...new Set(report.tests.map((t) => t.file))], [
    "test/fixtures/agent-trace.fixture.ts", "test/fixtures/failing.fixture.ts", "test/fixtures/only.fixture.ts",
  ], "results are in the same file order as a serial run");
  assert.match(readFileSync(join(dir, "junit.xml"), "utf8"), /<testsuites name="lithe" tests="9" failures="5"/);
});

test("--jobs runs files at the same time, and keeps each file's output together", () => {
  const log = join(mkdtempSync(join(tmpdir(), "lithe-par-")), "times.log");
  const file = (name) => `
    import { test } from ${JSON.stringify(litheUrl)};
    import { appendFileSync } from "node:fs";
    test("${name} first", async () => {
      appendFileSync(${JSON.stringify(log)}, "${name} start " + Date.now() + "\\n");
      await new Promise((r) => setTimeout(r, 700));
      appendFileSync(${JSON.stringify(log)}, "${name} end " + Date.now() + "\\n");
    });
    test("${name} second", () => {});`;
  const dir = tempProject({ "a.test.mjs": file("a"), "b.test.mjs": file("b") });
  const { code, out } = litheIn(dir, "--jobs", "2");
  assert.equal(code, 0, out);
  const t = Object.fromEntries(readFileSync(log, "utf8").trim().split("\n").map((l) => { const [n, k, v] = l.split(" "); return [`${n}-${k}`, Number(v)]; }));
  assert.ok(t["a-start"] < t["b-end"] && t["b-start"] < t["a-end"], `files should overlap in time: ${JSON.stringify(t)}`);
  assert.match(out, /a\.test\.mjs\n  ✓ a first[^\n]*\n  ✓ a second/);
  assert.match(out, /b\.test\.mjs\n  ✓ b first[^\n]*\n  ✓ b second/);
  rmSync(dir, { recursive: true, force: true });
});

test("--jobs rejects invalid values", () => {
  const { code, out } = lithe("examples", "--jobs", "0");
  assert.notEqual(code, 0);
  assert.match(out, /--jobs must be a positive whole number or "auto"/);
});
