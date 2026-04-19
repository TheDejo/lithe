import { test } from "../src/core/test";
import { expect } from "../src/core/expect";

async function fakeAgent(input: string) {
  return {
    jobs: ["Frontend Developer", "Backend Developer"]
  };
}

test("returns frontend jobs", async () => {
  const result = await fakeAgent("frontend jobs");

  expect(result.jobs).toContain("Frontend Developer");
});