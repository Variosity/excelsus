/**
 * General-purpose, stateless tools: web search (Brave, free tier) and
 * current date/time so the model doesn't have to guess "today."
 *
 * Email lives in emailTools.js instead — it needs per-connection pending
 * state for the draft/confirm/cancel flow, so it can't be a flat module
 * like this one.
 */

const declarations = [
  {
    name: 'web_search',
    description: 'Search the live web for current information — news, prices, facts you are not certain about, anything time-sensitive.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_current_datetime',
    description: 'Get the current date and time. Use this before answering anything involving "today", "this week", scheduling, or deadlines.',
    parameters: { type: 'object', properties: {} }
  }
];

async function web_search({ query }) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return { error: 'BRAVE_API_KEY not configured on the server.' };
  }
  const resp = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
    { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey } }
  );
  if (!resp.ok) {
    return { error: `Brave search failed with status ${resp.status}` };
  }
  const data = await resp.json();
  const results = (data.web?.results || []).slice(0, 5).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description
  }));
  return { results };
}

async function get_current_datetime() {
  return { iso: new Date().toISOString() };
}

const handlers = { web_search, get_current_datetime };

module.exports = { declarations, handlers };
