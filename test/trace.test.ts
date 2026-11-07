import { describe, test, expect, fn, note, traced } from "../src";

describe("tracing", () => {
  test("traced() passes arguments and results through unchanged", async () => {
    const add = traced("add", (a: number, b: number) => a + b);
    const fetchName = traced("fetchName", async (id: number) => `user-${id}`);
    expect(add(2, 3)).toBe(5);
    await expect(fetchName(7)).resolves.toBe("user-7");
    expect(add.name).toBe("add");
  });

  test("traced() rethrows errors", async () => {
    const boom = traced("boom", () => {
      throw new Error("nope");
    });
    const reject = traced("reject", async () => {
      throw new Error("async nope");
    });
    expect(() => boom()).toThrow("nope");
    await expect(reject()).rejects.toThrow("async nope");
  });

  test("named mocks still behave like mocks", () => {
    const tool = fn((q: string) => q.toUpperCase()).mockName("search");
    expect(tool("hi")).toBe("HI");
    expect(tool).toHaveBeenCalledWith("hi");
    expect(tool.getMockName()).toBe("search");
  });

  test("note() is safe to call anywhere, including outside tests", () => {
    note("picked the cheapest model", { model: "small", reason: "short prompt" });
    note("no data");
  });
});

// Called at load time, outside any test: must not throw or leak into a trace.
note("module loaded");
traced("outside", () => 1)();
