// An agent whose behaviour depends on AGENT_VARIANT, so two runs can be compared.
import { test, expect, fn, note } from "../../src";

const variant = process.env.AGENT_VARIANT ?? "v1";

async function planTrip(city: string, search: (q: string) => Promise<string[]>) {
  const query = variant === "v1" ? `things to do in ${city}` : `${city} restaurants`;
  note("chose search query", { query, variant });
  const results = await search(query);
  return results[0];
}

test("plans a trip", async () => {
  const search = fn(async (q: string) => [`Top pick for "${q}"`]).mockName("search");
  const pick = await planTrip("Chicago", search);
  expect(pick).toContain("things to do");
});

test("unchanged test", () => {
  note("always the same");
  expect(1).toBe(1);
});
