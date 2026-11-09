// Setup for the live checks: configures a real judge and real embeddings
// when the matching API key is present. Run with `npm run test:live`.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { configure } from "../src";

const anthropicKey = !!process.env.ANTHROPIC_API_KEY;
const openaiKey = !!process.env.OPENAI_API_KEY;

if (anthropicKey) {
  const anthropic = new Anthropic();
  configure({
    judge: async (prompt) => {
      const response = await anthropic.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content: prompt }],
      });
      if (response.stop_reason === "refusal") throw new Error("The judge model declined to grade this output");
      return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    },
  });
}

if (openaiKey) {
  const openai = new OpenAI();
  configure({
    embed: async (texts) => {
      const response = await openai.embeddings.create({ model: "text-embedding-3-small", input: texts });
      return response.data.map((item) => item.embedding);
    },
  });
}

console.log(
  `Live checks: Anthropic ${anthropicKey ? "on" : "off (set ANTHROPIC_API_KEY)"}, ` +
    `OpenAI ${openaiKey ? "on" : "off (set OPENAI_API_KEY)"}`
);
