// The record-and-replay example from the README, kept here so it is
// type-checked against the real Anthropic SDK on every `npm test`.
// Not a test file (no .test. in the name), so it never calls the API.
import Anthropic from "@anthropic-ai/sdk";
import { test, expect, recorded } from "../../src"; // in your project: "@thedejo/lithe"

const client = new Anthropic();
const ask = recorded("claude", (question: string) =>
  client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    messages: [{ role: "user", content: question }],
  })
);

test("answers with a delivery day", async () => {
  const response = await ask("When will order A-1042 arrive? It shipped Tuesday with 3-day delivery.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  expect(text).toContainAny(["friday", "fri"]);
});
