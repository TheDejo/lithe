// Testing an agent built on the OpenAI SDK, without network calls or an API key.
//
// Same pattern as anthropic-sdk.test.ts: construct the real client with a dummy
// key and stub `client.chat.completions.create` with spyOn().
import OpenAI from "openai";
import { describe, test, expect, fn, spyOn, beforeEach } from "../../src";

// --- the agent under test ---------------------------------------------------

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_order",
      description: "Look up an order by its id. Returns status and delivery estimate.",
      parameters: {
        type: "object",
        properties: { orderId: { type: "string" } },
        required: ["orderId"],
      },
    },
  },
];

type GetOrder = (orderId: string) => Promise<Record<string, unknown>>;

export async function supportAgent(client: OpenAI, question: string, getOrder: GetOrder): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "You are a support agent for an online store. Use get_order to look up orders." },
    { role: "user", content: question },
  ];

  for (let step = 0; step < 5; step++) {
    const completion = await client.chat.completions.create({ model: "gpt-5", tools, messages });
    const message = completion.choices[0].message;

    if (!message.tool_calls?.length) return message.content ?? "";

    messages.push(message);
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;
      const { orderId } = JSON.parse(call.function.arguments) as { orderId: string };
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(await getOrder(orderId)) });
    }
  }
  throw new Error("Agent did not finish in 5 steps");
}

// --- helpers to script model responses --------------------------------------

function completion(message: Partial<OpenAI.Chat.ChatCompletionMessage>): OpenAI.Chat.ChatCompletion {
  return {
    id: "chatcmpl_test",
    object: "chat.completion",
    created: 0,
    model: "gpt-5",
    choices: [
      {
        index: 0,
        finish_reason: message.tool_calls ? "tool_calls" : "stop",
        logprobs: null,
        message: { role: "assistant", content: null, refusal: null, ...message },
      },
    ],
  } as OpenAI.Chat.ChatCompletion;
}

const callTool = (name: string, args: unknown) => ({
  tool_calls: [{ id: "call_1", type: "function" as const, function: { name, arguments: JSON.stringify(args) } }],
});

// --- tests --------------------------------------------------------------------

describe("support agent (OpenAI SDK)", () => {
  const client = new OpenAI({ apiKey: "test-key" });
  const create = spyOn(client.chat.completions, "create").mockName("chat.completions.create");
  const getOrder = fn<GetOrder>(async (orderId) => ({ orderId, status: "shipped", eta: "Friday" })).mockName("get_order");

  beforeEach(() => {
    create.mockReset();
    getOrder.mockClear();
  });

  test("looks up the order, then answers from the tool result", async () => {
    create
      .mockResolvedValueOnce(completion(callTool("get_order", { orderId: "A-1042" })) as any)
      .mockResolvedValueOnce(completion({ content: "Order A-1042 has shipped and should arrive Friday." }) as any);

    const answer = await supportAgent(client, "Where is my order A-1042?", getOrder);

    expect(getOrder).toHaveBeenCalledWith("A-1042");
    expect(create).toHaveBeenCalledTimes(2);
    expect(answer).toContainAll(["shipped", "friday"]);

    const secondRequest = create.mock.calls[1][0] as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
    expect(secondRequest.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "call_1", content: expect.stringContaining("shipped") });
  });

  test("answers directly when no lookup is needed", async () => {
    create.mockResolvedValueOnce(completion({ content: "We ship to all 50 US states." }) as any);

    const answer = await supportAgent(client, "Do you ship to Alaska?", getOrder);

    expect(getOrder).not.toHaveBeenCalled();
    expect(answer).toContain("50 US states");
  });
});
