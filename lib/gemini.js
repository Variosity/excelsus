/**
 * Thin wrapper around Gemini's generateContent REST endpoint, with a
 * function-calling loop: keeps sending the conversation back with tool
 * results appended until the model returns plain text instead of another
 * function call.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const API_KEY = process.env.GEMINI_API_KEY;
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = `You are Excelsus, a personal AI operations assistant built by Macaracachimba (Alejandro Fernandez) for his multi-venture business, centered on the Excelsus Agency (AI websites, chatbots, and voice receptionists for local businesses).

Personality: sharp, direct, a little dry — closer to a competent chief of staff than a chatbot. Short spoken-style sentences, since your replies are often read aloud. No filler like "I'd be happy to help" or "Great question!" — just answer.

You have tools to read and write his live Excelsus CRM (leads, clients, dashboard stats, proposals), search the web, check the date/time, and send email. Use them whenever a question depends on real data instead of guessing or making up numbers — especially anything about leads, clients, revenue, or "how's the business doing."

Email is a two-step, voice-confirmable flow — never skip the steps:
1. When asked to send an email, call prepare_email to stage it. This does not send anything. Read the to/subject/body back to him in your reply and ask him to confirm or cancel.
2. Only call confirm_pending_email if his NEXT message is a clear yes — "send it", "confirmed", "go ahead." Only call cancel_pending_email if he backs out, says no, says to stop, or seems to change his mind.
3. Never call prepare_email and confirm_pending_email in the same turn, even if his original request sounded certain — he needs the chance to hear it back and cancel by voice before it goes anywhere.
4. If he asks to change something about a pending draft, call prepare_email again with the corrected version rather than confirming the old one.

If a tool call fails or a tool isn't configured, say so plainly instead of pretending it worked.

Keep replies concise — a few sentences unless he's asked for a detailed breakdown.`;

async function callGemini(contents, toolDeclarations) {
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents,
    tools: toolDeclarations.length ? [{ functionDeclarations: toolDeclarations }] : undefined
  };

  const resp = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${errText}`);
  }

  return resp.json();
}

/**
 * Runs the full agent loop for one user turn.
 *
 * @param {Array} history - prior turns, in Gemini `contents` format (role/parts)
 * @param {string} userText - the new user message
 * @param {{declarations: object[], handlers: Record<string, Function>}[]} toolSets
 * @returns {Promise<{ replyText: string, history: Array }>}
 */
async function runTurn(history, userText, toolSets) {
  const declarations = toolSets.flatMap((t) => t.declarations);
  const handlers = Object.assign({}, ...toolSets.map((t) => t.handlers));

  const contents = [...history, { role: 'user', parts: [{ text: userText }] }];

  const MAX_TOOL_ROUNDS = 6;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callGemini(contents, declarations);
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

    if (functionCalls.length === 0) {
      const replyText = parts.map((p) => p.text || '').join('').trim() ||
        "I didn't get a response back from the model just then — try that again?";
      contents.push({ role: 'model', parts });
      return { replyText, history: contents };
    }

    // Model wants to call one or more tools — push its request, run them, push results
    contents.push(candidate.content);

    const responseParts = [];
    for (const call of functionCalls) {
      const handler = handlers[call.name];
      let result;
      try {
        result = handler ? await handler(call.args || {}) : { error: `Unknown tool: ${call.name}` };
      } catch (err) {
        result = { error: err.message };
      }
      responseParts.push({
        functionResponse: {
          name: call.name,
          // Gemini's function_response.response field must be a JSON object,
          // never a bare array — wrap array results (list_leads, list_clients,
          // list_proposals, etc.) so the API doesn't reject them with
          // "Proto field is not repeating, cannot start list."
          response: Array.isArray(result) ? { results: result } : result
        }
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return {
    replyText: "That took more tool calls than I'm allowed to chain — try breaking the request down.",
    history: contents
  };
}

module.exports = { runTurn };
