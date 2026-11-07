// Testing an agent built on the Anthropic SDK, without network calls or an API key.
//
// The agent receives a real `Anthropic` client. In tests we construct one with a
// dummy key and stub `client.messages.create` with spyOn(), so every request the
// agent sends is recorded (and shows up in the test's trace) while the responses
// are scripted. Drop the stub to run the same test against the real API.
import Anthropic from "@anthropic-ai/sdk";
import { describe, test, expect, fn, spyOn, beforeEach } from "../../src";

// --- the agent under test ---------------------------------------------------

const tools: Anthropic.Tool[] = [
  {
    name: "get_order",
    description: "Look up an order by its id. Returns status and delivery estimate.",
    input_schema: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
    },
  },
];

type GetOrder = (orderId: string) => Promise<Record<string, unknown>>;

export async function supportAgent(client: Anthropic, question: string, getOrder: GetOrder): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  for (let step = 0; step < 5; step++) {
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: "You are a support agent for an online store. Use get_order to look up orders.",
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") throw new Error("Request was declined");
    if (response.stop_reason !== "tool_use") {
      return response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const { orderId } = block.input as { orderId: string };
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(await getOrder(orderId)) });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("Agent did not finish in 5 steps");
}

// --- helpers to script model responses --------------------------------------

function reply(stop_reason: Anthropic.StopReason, content: Anthropic.ContentBlock[]): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as Anthropic.Message;
}

const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.TextBlock;
const toolUse = (name: string, input: unknown) =>
  ({ type: "tool_use", id: "toolu_1", name, input }) as Anthropic.ToolUseBlock;

// --- tests --------------------------------------------------------------------

describe("support agent (Anthropic SDK)", () => {
  const client = new Anthropic({ apiKey: "test-key" });
  const create = spyOn(client.messages, "create").mockName("messages.create");
  const getOrder = fn<GetOrder>(async (orderId) => ({ orderId, status: "shipped", eta: "Friday" })).mockName("get_order");

  beforeEach(() => {
    create.mockReset();
    getOrder.mockClear();
  });

  test("looks up the order, then answers from the tool result", async () => {
    create
      .mockResolvedValueOnce(reply("tool_use", [toolUse("get_order", { orderId: "A-1042" })]) as any)
      .mockResolvedValueOnce(reply("end_turn", [text("Order A-1042 has shipped and should arrive Friday.")]) as any);

    const answer = await supportAgent(client, "Where is my order A-1042?", getOrder);

    expect(getOrder).toHaveBeenCalledWith("A-1042");
    expect(create).toHaveBeenCalledTimes(2);
    expect(answer).toContainAll(["shipped", "friday"]);

    // The second request must hand the tool result back to the model.
    const secondRequest = create.mock.calls[1][0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(secondRequest.messages.at(-1)).toEqual({
      role: "user",
      content: [expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_1" })],
    });
  });

  test("answers directly when no lookup is needed", async () => {
    create.mockResolvedValueOnce(reply("end_turn", [text("We ship to all 50 US states.")]) as any);

    const answer = await supportAgent(client, "Do you ship to Alaska?", getOrder);

    expect(getOrder).not.toHaveBeenCalled();
    expect(answer).toContain("50 US states");
  });

  test("surfaces a refusal instead of returning an empty answer", async () => {
    create.mockResolvedValueOnce(reply("refusal", []) as any);

    await expect(supportAgent(client, "...", getOrder)).rejects.toThrow("declined");
  });
});
