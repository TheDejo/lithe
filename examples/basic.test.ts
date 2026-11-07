// In your own project: import { test, expect } from "@thedejo/lithe";
import { test, expect } from "../src";

async function fakeAgent(input: string) {
  return {
    jobs: ["Frontend Developer", "Backend Developer"],
  };
}

test("returns frontend jobs", async () => {
  const result = await fakeAgent("frontend jobs");

  expect(result.jobs).toContain("Frontend Developer");
});
