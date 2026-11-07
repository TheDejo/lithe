// A multi-step agent with a mocked LLM client and tool, tested end to end.
// In your own project: import { describe, test, expect, fn, beforeEach } from "@thedejo/lithe";
import { describe, test, expect, fn, beforeEach } from "../src";

type Message = { role: "user" | "assistant" | "tool"; content: string };
type LLM = (messages: Message[]) => Promise<string>;

/** A tiny agent: asks the LLM, runs a tool if requested, then answers. */
async function weatherAgent(question: string, llm: LLM, getWeather: (city: string) => Promise<string>) {
  const messages: Message[] = [{ role: "user", content: question }];
  for (let step = 0; step < 5; step++) {
    const reply = await llm(messages);
    const call = reply.match(/^CALL getWeather\((.+)\)$/);
    if (!call) return { answer: reply, steps: step + 1, messages };
    messages.push({ role: "assistant", content: reply });
    messages.push({ role: "tool", content: await getWeather(call[1]) });
  }
  throw new Error("Agent did not finish in 5 steps");
}

describe("weather agent", () => {
  // Named mocks record every call in the test's trace, so a failure (or
  // `lithe compare`) shows exactly what the agent did, step by step.
  const llm = fn<LLM>().mockName("llm");
  const getWeather = fn(async (city: string) => `64°F and sunny in ${city}`).mockName("getWeather");

  beforeEach(() => {
    llm.mockReset();
    getWeather.mockClear();
  });

  test("calls the weather tool, then answers using its result", async () => {
    llm
      .mockResolvedValueOnce("CALL getWeather(San Francisco)")
      .mockResolvedValueOnce("It's 64°F and sunny in San Francisco right now.");

    const result = await weatherAgent("What's the weather in San Francisco?", llm, getWeather);

    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(getWeather).toHaveBeenCalledWith("San Francisco");
    expect(result.steps).toBe(2);
    // LLM wording varies, so assert on meaning-bearing pieces, not exact text.
    expect(result.answer).toContainAll(["san francisco", "sunny"]);
    expect(result.messages).toContainEqual({ role: "tool", content: expect.stringContaining("64°F") });
  });

  test("answers directly when no tool is needed", async () => {
    llm.mockResolvedValueOnce("Hello! Ask me about the weather anywhere.");

    const result = await weatherAgent("hi", llm, getWeather);

    expect(getWeather).not.toHaveBeenCalled();
    expect(result).toMatchObject({ steps: 1, answer: expect.any(String) });
  });

  test("gives up on a runaway tool loop", async () => {
    llm.mockResolvedValue("CALL getWeather(San Francisco)");

    await expect(weatherAgent("loop forever", llm, getWeather)).rejects.toThrow("did not finish");
    expect(llm).toHaveBeenCalledTimes(5);
  });

  test("returns structured JSON when asked", async () => {
    llm.mockResolvedValueOnce('{"city":"San Francisco","tempF":64,"conditions":"sunny"}');

    const { answer } = await weatherAgent("weather in San Francisco as JSON", llm, getWeather);

    expect(answer).toBeJSON({ city: "San Francisco", tempF: expect.any(Number) });
  });
});
