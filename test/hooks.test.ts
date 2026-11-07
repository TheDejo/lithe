import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "../src";

const log: string[] = [];

describe("hooks", () => {
  beforeAll(() => {
    log.push("beforeAll");
  });
  beforeEach(() => {
    log.push("beforeEach");
  });
  afterEach(() => {
    log.push("afterEach");
  });
  afterAll(() => {
    log.push("afterAll");
  });

  test("first", () => {
    log.push("first");
  });

  describe("nested", () => {
    beforeEach(() => {
      log.push("nested beforeEach");
    });

    test("second", () => {
      log.push("second");
    });
  });
});

test("hooks ran in order", () => {
  expect(log).toEqual([
    "beforeAll",
    "beforeEach", "first", "afterEach",
    "beforeEach", "nested beforeEach", "second", "afterEach",
    "afterAll",
  ]);
});

let attempts = 0;
test("retries a flaky test", () => {
  attempts++;
  if (attempts < 3) throw new Error("flaky");
}, { retries: 2 });

test("a slow async test can raise its own timeout", async () => {
  await new Promise((r) => setTimeout(r, 30));
}, 1000);

test.skip("skipped tests do not run", () => {
  throw new Error("should not run");
});

test.todo("todo tests are reported");
