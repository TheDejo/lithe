import { test, expect } from "../../dist/index.js";
test("esm works", async () => { expect(await Promise.resolve(2)).toBe(2); });
