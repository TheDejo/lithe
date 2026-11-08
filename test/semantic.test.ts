import { describe, test, expect, configure, beforeAll, afterAll, AssertionError } from "../src";
import { getConfig, parseVerdict, judgePrompt, cosine } from "../src/core/semantic";

// A deterministic stand-in for an LLM judge: passes when every word of the
// reference / criteria marked [must: ...] appears in the output.
const prompts: string[] = [];
function fakeJudge(prompt: string) {
  prompts.push(prompt);
  const output = prompt.split("<output>\n")[1].split("\n</output>")[0].toLowerCase();
  const required = [...prompt.matchAll(/\[must: ([^\]]+)\]/g)].map((m) => m[1].toLowerCase());
  const missing = required.filter((w) => !output.includes(w));
  return "```json\n" + JSON.stringify({ pass: missing.length === 0, reason: missing.length ? `missing ${missing.join(", ")}` : "all present" }) + "\n```";
}

// Bag-of-words embeddings over a tiny vocabulary.
const vocab = ["order", "ships", "friday", "refund", "delayed", "monday"];
const fakeEmbed = (texts: string[]) => texts.map((t) => vocab.map((w) => (t.toLowerCase().includes(w) ? 1 : 0)));

let saved: ReturnType<typeof getConfig>;
beforeAll(() => {
  saved = { ...getConfig() };
  configure({ judge: fakeJudge, embed: fakeEmbed });
});
afterAll(() => configure({ judge: saved.judge, embed: saved.embed }));

async function failsWith(p: Promise<unknown>, part: string) {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof AssertionError) && !(e instanceof Error)) throw e;
    if (!(e as Error).message.includes(part)) throw new Error(`Expected message to include ${JSON.stringify(part)}, got:\n${(e as Error).message}`);
    return;
  }
  throw new Error("Expected the assertion to fail");
}

describe("toMean", () => {
  test("passes when the judge says the meaning matches", async () => {
    await expect("Your order ships on Friday.").toMean("[must: friday] It goes out Friday");
    expect(prompts.at(-1)).toContain("Reference answer: [must: friday] It goes out Friday");
    expect(prompts.at(-1)).toContain("<output>\nYour order ships on Friday.\n</output>");
  });

  test("fails with the judge's reason", async () => {
    await failsWith(expect("It ships Monday.").toMean("[must: friday] Friday"), "Judge: missing friday");
  });

  test(".not inverts", async () => {
    await expect("It ships Monday.").not.toMean("[must: friday] Friday");
    await failsWith(expect("Friday!").not.toMean("[must: friday] Friday"), "not.toMean");
  });

  test("works with .resolves", async () => {
    await expect(Promise.resolve("ships friday")).resolves.toMean("[must: friday] Friday");
  });

  test("non-string values are sent as JSON", async () => {
    await expect({ day: "Friday" }).toMean("[must: friday] Friday");
    expect(prompts.at(-1)).toContain('"day": "Friday"');
  });
});

describe("toMeetCriteria", () => {
  test("sends every criterion and passes when all are met", async () => {
    await expect("Sorry for the wait. Your refund is on its way.").toMeetCriteria([
      "Apologises [must: sorry]",
      "Mentions the refund [must: refund]",
    ]);
    expect(prompts.at(-1)).toContain("1. Apologises [must: sorry]\n2. Mentions the refund [must: refund]");
  });

  test("accepts a single criterion and reports what failed", async () => {
    await failsWith(expect("Hello").toMeetCriteria("Mentions the refund [must: refund]"), "missing refund");
  });
});

describe("toBeSimilarTo", () => {
  test("compares embeddings against a threshold", async () => {
    await expect("Your order ships Friday").toBeSimilarTo("The order ships on Friday");
    await expect("Refund delayed until Monday").not.toBeSimilarTo("The order ships on Friday");
    await failsWith(expect("Refund delayed").toBeSimilarTo("order ships friday", { threshold: 0.5 }), "Similarity: 0.000");
  });

  test("cosine similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(() => cosine([1], [1, 2])).toThrow("same length");
  });
});

describe("verdict parsing", () => {
  test("reads JSON, fenced JSON, and JSON inside prose", () => {
    expect(parseVerdict('{"pass": true, "reason": "ok"}')).toEqual({ pass: true, reason: "ok" });
    expect(parseVerdict('```json\n{"pass": false, "reason": "no"}\n```')).toEqual({ pass: false, reason: "no" });
    expect(parseVerdict('Sure. {"pass": true, "reason": "fine"} Hope that helps')).toEqual({ pass: true, reason: "fine" });
  });

  test("rejects replies without a verdict", () => {
    expect(() => parseVerdict("I think it passes")).toThrow("could not be read as a verdict");
  });

  test("the prompt asks for JSON only", () => {
    expect(judgePrompt("out", ["a"])).toContain('Reply with only a JSON object');
  });
});

test("a clear error when no judge is configured", async () => {
  configure({ judge: undefined });
  try {
    await failsWith(expect("x").toMean("y"), "Call configure({ judge })");
  } finally {
    configure({ judge: fakeJudge });
  }
});
