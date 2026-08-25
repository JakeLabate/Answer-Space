import { api, withRetry } from "./util.js";

/* One worker model does profiling, prompt writing and citation extraction.
   Kept separate from the answer channels so measurement never uses the model
   under measurement — you do not want ChatGPT grading ChatGPT's own answer. */

const ANTHROPIC_MODEL = process.env.WORKER_MODEL_ANTHROPIC || "claude-sonnet-4-5";
const OPENAI_MODEL    = process.env.WORKER_MODEL_OPENAI    || "gpt-5";

export async function structured({ system, user, schema, name = "result", maxTokens = 8000 }) {
  const provider = (process.env.WORKER_PROVIDER || "anthropic").toLowerCase();
  return provider === "openai"
    ? openaiStructured({ system, user, schema, name, maxTokens })
    : anthropicStructured({ system, user, schema, name, maxTokens });
}

async function anthropicStructured({ system, user, schema, name, maxTokens }) {
  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    tools: [{ name, description: "Return the result.", input_schema: schema }],
    tool_choice: { type: "tool", name },
  };
  const j = await withRetry(() => api("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  }), { label: "worker(anthropic)" });
  const block = (j.content || []).find((b) => b.type === "tool_use");
  if (!block) throw new Error("worker returned no tool_use block");
  return block.input;
}

async function openaiStructured({ system, user, schema, name, maxTokens }) {
  const j = await withRetry(() => api("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: system,
      input: user,
      max_output_tokens: maxTokens,
      text: { format: { type: "json_schema", name, strict: false, schema } },
    }),
  }), { label: "worker(openai)" });
  const txt = (j.output || [])
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text).join("");
  return JSON.parse(txt);
}
