// Example setup file for semantic assertions. Load it with:
//
//   npx lithe --setup examples/integrations/semantic.setup.ts
//
// It needs ANTHROPIC_API_KEY (for the judge) and OPENAI_API_KEY (for embeddings).
// Use whichever providers you like: a judge is any (prompt) => text function,
// and an embedder is any (texts) => vectors function.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { configure } from "../../src"; // in your project: "@thedejo/lithe"

const anthropic = new Anthropic();
const openai = new OpenAI();

configure({
  // Used by toMean() and toMeetCriteria().
  judge: async (prompt) => {
    const response = await anthropic.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If this model declines a request, the API retries it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") {
      throw new Error("The judge model declined to grade this output");
    }
    return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  },

  // Used by toBeSimilarTo().
  embed: async (texts) => {
    const response = await openai.embeddings.create({ model: "text-embedding-3-small", input: texts });
    return response.data.map((item) => item.embedding);
  },
});
