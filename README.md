# Lithe

Lithe is an open-source test runner for AI agents.

## Example

```ts
test("agent returns relevant jobs", async () => {
  const result = await agent.run("frontend jobs");

  expect(result.jobs).toContain("Frontend Developer");
});