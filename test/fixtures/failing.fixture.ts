import { test, expect, describe, beforeAll } from "../../src";

test("passes", () => expect(1).toBe(1));
test("fails with a diff", () => expect({ answer: "Paris" }).toEqual({ answer: "Lyon" }));
test("times out", () => new Promise(() => {}), 50);
test("unhandled rejection is attributed to the test", async () => {
  Promise.reject(new Error("escaped"));
  await new Promise((r) => setTimeout(r, 20));
});

describe("broken setup", () => {
  beforeAll(() => {
    throw new Error("db down");
  });
  test("never runs its body", () => {});
});
