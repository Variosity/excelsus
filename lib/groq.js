/**
 * Groq fallback — used when Gemini errors out (quota, rate limit, API
 * outage, whatever). Groq's API is OpenAI-compatible, so tool declarations
 * and history need converting from Gemini's shape into OpenAI's, but the
 * exported runTurn() signature matches lib/gemini.js exactly: same plain
 * -text history in, same shape out. server.js can swap between the two
 * without caring which one actually answered.
 *
 * Model: llama-3.3-70b-versatile — picked for reliable native tool-calling
 * (some newer/smaller Groq models are shakier at this) plus a free-tier
 * daily cap (1,000 RPD as of Aug 2026) well above Gemini's free-tier limits,
 * so it holds up as a real fallback instead of just moving the same problem.
 * Override with GROQ_MODEL if Groq's lineup changes later.
 */

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const API_KEY = process.env.GROQ_API_KEY;
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_INSTRUCTION = `You are Excelsus, a personal AI operations assistant built by Macaracachimba (Alejandro Fernandez) for his multi-venture business, centered on the Excelsus Agency (AI websites, chatbots, and voice receptionists for local businesses).

Personality: sharp, direct, a little dry — closer to a competent chief of staff than a chatbot. Short spoken-style sentences, since your replies are often read aloud. No filler like "I'd be happy to help" or "Great question!" — just answer.

You have tools to read and write his live Excelsus CRM (leads, clients, dashboard stats, proposals), search the web, check the date/time, and send email. Use them whenever a question depends on real data instead of guessing or making up numbers — especially anything about leads, clients, revenue, or "how's the business doing."

Email is a two-step, voice-confirmable flow — never skip the steps:
1. When asked to send an email, call prepare_email to stage it. This does not send anything. Read the to/subject/body back to him in your reply and ask him to confirm or cancel.
2. Only call confirm_pending_email if his NEXT message is a clear yes — "send it", "confirmed", "go ahead." Only call cancel_pending_email if he backs out, says no, says to stop, or seems to change his mind.
3. Never call prepare_email and confirm_pending_email in the same turn, even if his original request sounded certain — he needs the chance to hear it back and cancel by voice before it goes anywhere.
4. If he asks to change something about a pending draft, call prepare_email again with the corrected version rather than confirming the old one.

If a tool call fails or a tool isn't configured, say so plainly instead of pretending it worked.

Keep replies concise — a few sentences unless he's asked for a detailed breakdown.

You are currently running on a backup model because the primary one is unavailable — don't mention this unless he asks.`;

function toOpenAiTools(declarations) {
  return declarations.map((d) => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description,
      parameters: d.parameters || { type: 'object', properties: {} }
    }
  }));
}

async function callGroq(messages, tools) {
  const body = {
    model: MODEL,
    messages,
    tools: tools.length ? tools : undefined
  };

  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Groq API error ${resp.status}: ${errText}`);
  }

  return resp.json();
}

/**
 * Same signature/shape as gemini.js's runTurn — see that file for the
 * shared plain-text history format.
 */
async function runTurn(history, userText, toolSets) {
  const declarations = toolSets.flatMap((t) => t.declarations);
  const handlers = Object.assign({}, ...toolSets.map((t) => t.handlers));
  const tools = toOpenAiTools(declarations);

  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    ...history.map((h) => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text })),
    { role: 'user', content: userText }
  ];

  const MAX_TOOL_ROUNDS = 6;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callGroq(messages, tools);
    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls || [];

    if (toolCalls.length === 0) {
      const replyText = (message?.content || '').trim() ||
        "I didn't get a response back from the model just then — try that again?";
      const newHistory = [...history, { role: 'user', text: userText }, { role: 'model', text: replyText }];
      return { replyText, history: newHistory };
    }

    // Model wants to call one or more tools — push its request, run them, push results
    messages.push(message);

    for (const call of toolCalls) {
      const handler = handlers[call.function?.name];
      let args = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        // malformed arguments — fall through with empty args, let the
        // handler's own validation surface the problem
      }
      let result;
      try {
        result = handler ? await handler(args) : { error: `Unknown tool: ${call.function?.name}` };
      } catch (err) {
        result = { error: err.message };
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
  }

  const replyText = "That took more tool calls than I'm allowed to chain — try breaking the request down.";
  const newHistory = [...history, { role: 'user', text: userText }, { role: 'model', text: replyText }];
  return { replyText, history: newHistory };
}

module.exports = { runTurn };
