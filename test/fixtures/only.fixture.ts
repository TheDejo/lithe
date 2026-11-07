import { test } from "../../src";
test("not this one", () => { throw new Error("should be skipped"); });
test.only("only this one", () => {});
