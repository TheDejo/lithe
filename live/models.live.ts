// Checks Lithe's model-facing features against real APIs.
// Not part of `npm test`: run `npm run test:live` with ANTHROPIC_API_KEY
// and/or OPENAI_API_KEY set. Checks without their key are skipped.
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { describe, test, expect } from "../src";

const withAnthropic = process.env.ANTHROPIC_API_KEY ? test : test.skip;
const withOpenAI = process.env.OPENAI_API_KEY ? test : test.skip;

describe("judge (Anthropic)", () => {
  withAnthropic("toMean accepts a paraphrase", async () => {
    await expect("Your package should reach you this Friday.").toMean("The order will be delivered on Friday.");
  });

  withAnthropic("toMean rejects a different meaning", async () => {
    await expect("Your package should reach you this Friday.").not.toMean("The order will be delivered on Monday.");
  });

  withAnthropic("toMeetCriteria passes when every criterion is met", async () => {
    await expect("Sorry for the delay! Your refund of $40 was sent today and should arrive in 3-5 days.").toMeetCriteria([
      "Apologises",
      "States the refund amount",
      "Says when the refund will arrive",
    ]);
  });

  withAnthropic("toMeetCriteria fails when a criterion is missed", async () => {
    await expect("Your refund was sent.").not.toMeetCriteria(["States the refund amount"]);
  });
});

describe("embeddings (OpenAI)", () => {
  withOpenAI("toBeSimilarTo accepts a paraphrase", async () => {
    await expect("Your package should reach you this Friday.").toBeSimilarTo("The order will be delivered on Friday.", { threshold: 0.6 });
  });

  withOpenAI("toBeSimilarTo rejects unrelated text", async () => {
    await expect("The capital of France is Paris.").not.toBeSimilarTo("The order will be delivered on Friday.", { threshold: 0.6 });
  });
});

describe("record and replay (Anthropic)", () => {
  withAnthropic("records a real response, then replays it with no key and no network", () => {
    const root = resolve(__dirname, "..");
    const cli = join(root, "dist/cli/index.js");
    // Inside the repo (a dot-folder discovery ignores) so the SDK resolves from node_modules.
    const dir = mkdtempSync(join(root, "live", ".run-"));
    try {
      writeFileSync(join(dir, "ask.test.mjs"), `
        import Anthropic from "@anthropic-ai/sdk";
        import { test, expect, recorded } from ${JSON.stringify(pathToFileURL(join(root, "dist/index.js")).href)};
        const ask = recorded("claude", (question) =>
          new Anthropic().messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages: [{ role: "user", content: question }] })
        );
        test("answers", async () => {
          const response = await ask("Reply with exactly the word: pong");
          const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
          expect(text).toContainAny(["pong"]);
        });`);
      const run = (args: string[], env: NodeJS.ProcessEnv) =>
        spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8", env: { ...env, NO_COLOR: "1" } });

      const recordRun = run(["--record", "--timeout", "120000"], process.env);
      expect(recordRun.status).toBe(0);
      const saved = JSON.parse(readFileSync(join(dir, "__recordings__", "ask.test.mjs.json"), "utf8"));
      expect(saved.tests.answers[0].result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text" })]));

      const { ANTHROPIC_API_KEY, ...noKey } = process.env;
      const replayRun = run([], { ...noKey, ANTHROPIC_BASE_URL: "http://127.0.0.1:9" });
      expect(replayRun.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
