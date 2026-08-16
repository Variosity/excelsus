/**
 * Base44 CRM bridge.
 *
 * Authenticates against your excelsus.base44.app app using your own login
 * (external apps only get user-level permissions, not service-role — see
 * @base44/sdk's README), then exposes your entities as tool functions Gemini
 * can call.
 *
 * Schemas below mirror the entities in base44/entities/*.jsonc from your
 * exported project (Lead, Client, Proposal). Update FIELDS_BY_ENTITY if you
 * add/rename fields in the Base44 editor later.
 */

const { createClient } = require('@base44/sdk');

let base44 = null;
let loginPromise = null;

function getClient() {
  if (!base44) {
    base44 = createClient({ appId: process.env.BASE44_APP_ID });
  }
  return base44;
}

// Logs in once, reuses the token for subsequent calls. Re-runs automatically
// if a call ever comes back 401 (see callWithRetry below).
async function ensureLoggedIn() {
  if (!loginPromise) {
    const client = getClient();
    loginPromise = client.auth
      .loginViaEmailPassword(process.env.BASE44_EMAIL, process.env.BASE44_PASSWORD)
      .catch((err) => {
        // Don't let a failed login attempt get cached forever — clear it so
        // the next call actually retries against Base44 instead of just
        // replaying this same rejected promise indefinitely.
        loginPromise = null;
        throw err;
      });
  }
  await loginPromise;
  return base44;
}

async function callWithRetry(fn) {
  await ensureLoggedIn();
  try {
    return await fn(base44);
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401 || status === 400) {
      loginPromise = null; // force re-login
      await ensureLoggedIn();
      return await fn(base44);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tool declarations (Gemini function-calling format) + handlers
// ---------------------------------------------------------------------------

const declarations = [
  {
    name: 'list_leads',
    description:
      "List leads from the Excelsus CRM's lead pipeline. Use this to answer questions like 'how many new leads do I have' or 'show me qualified leads in Orlando'.",
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['new', 'contacted', 'qualified', 'client', 'lost'],
          description: 'Filter by pipeline status. Omit to get all statuses.'
        },
        bucket: {
          type: 'string',
          enum: ['no_website', 'areteguard', 'chatbot_upgrade', 'add_chatbot'],
          description: 'Filter by lead bucket/category. Omit for all.'
        },
        limit: {
          type: 'number',
          description: 'Max number of leads to return. Default 25.'
        }
      }
    }
  },
  {
    name: 'create_lead',
    description: 'Add a new lead to the CRM pipeline.',
    parameters: {
      type: 'object',
      properties: {
        business_name: { type: 'string' },
        website: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        industry: { type: 'string' },
        city: { type: 'string' },
        lead_type: { type: 'string', enum: ['receptionist', 'website'] },
        notes: { type: 'string' }
      },
      required: ['business_name']
    }
  },
  {
    name: 'update_lead_status',
    description: "Move a lead to a new pipeline stage (e.g. mark as 'contacted' or 'qualified').",
    parameters: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'The Base44 record id of the lead.' },
        status: {
          type: 'string',
          enum: ['new', 'contacted', 'qualified', 'client', 'lost']
        }
      },
      required: ['lead_id', 'status']
    }
  },
  {
    name: 'list_clients',
    description: 'List paying/active clients from the CRM.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'trial', 'paused', 'churned'],
          description: 'Filter by client status. Omit for all.'
        }
      }
    }
  },
  {
    name: 'get_dashboard_stats',
    description:
      "Pull a snapshot of the whole business: lead counts by stage, client counts by status, and total monthly recurring revenue. Use this for any 'how's the business doing' / 'what's my MRR' type question.",
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'list_proposals',
    description: 'List proposals that have been generated/sent to prospects.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max number to return. Default 10, most recent first.' }
      }
    }
  },
  {
    name: 'scrape_website_leads',
    description:
      "Run a real, live search for local businesses in a city/industry that have NO website (or a very weak web presence) — website-client sales prospects. Backed by Google Places API, not fabricated data. Casts a wide net across several query variations to surface smaller local businesses specifically. Use this whenever asked to 'scrape', 'find', or 'search for' leads/prospects for website clients.",
    parameters: {
      type: 'object',
      properties: {
        industry: { type: 'string', description: "e.g. 'restaurants', 'plumbers', 'auto repair shops'" },
        city: { type: 'string', description: "e.g. 'Winter Garden, Florida'" },
        limit: { type: 'number', description: 'Max leads to return, up to 20. Default 15.' },
        save_to_crm: {
          type: 'boolean',
          description: 'Whether to save the found leads into the CRM as new Lead records. Default true.'
        }
      },
      required: ['industry', 'city']
    }
  },
  {
    name: 'scrape_receptionist_leads',
    description:
      "Run a real, live search for local businesses in a city/industry that DO have a website — AI-receptionist/chatbot-upgrade sales prospects. Backed by Google Places API, not fabricated data. Use this whenever asked to 'scrape', 'find', or 'search for' leads/prospects for the receptionist or chatbot product line.",
    parameters: {
      type: 'object',
      properties: {
        industry: { type: 'string', description: "e.g. 'dentists', 'salons', 'law firms'" },
        city: { type: 'string', description: "e.g. 'Winter Garden, Florida'" },
        limit: { type: 'number', description: 'Max leads to return, up to 20. Default 15.' },
        save_to_crm: {
          type: 'boolean',
          description: 'Whether to save the found leads into the CRM as new Lead records. Default true.'
        }
      },
      required: ['industry', 'city']
    }
  }
];

async function list_leads({ status, bucket, limit } = {}) {
  return callWithRetry(async (client) => {
    const query = {};
    if (status) query.status = status;
    if (bucket) query.bucket = bucket;
    const leads = Object.keys(query).length
      ? await client.entities.Lead.filter(query, '-created_date', limit || 25)
      : await client.entities.Lead.list('-created_date', limit || 25);
    return leads.map((l) => ({
      id: l.id,
      business_name: l.business_name,
      status: l.status,
      bucket: l.bucket,
      city: l.city,
      phone: l.phone,
      email: l.email
    }));
  });
}

async function create_lead(args) {
  return callWithRetry(async (client) => {
    const lead = await client.entities.Lead.create(args);
    return { created: true, id: lead.id, business_name: lead.business_name };
  });
}

async function update_lead_status({ lead_id, status }) {
  return callWithRetry(async (client) => {
    await client.entities.Lead.update(lead_id, { status });
    return { updated: true, lead_id, status };
  });
}

async function list_clients({ status } = {}) {
  return callWithRetry(async (client) => {
    const clients = status
      ? await client.entities.Client.filter({ status }, '-created_date', 50)
      : await client.entities.Client.list('-created_date', 50);
    return clients.map((c) => ({
      id: c.id,
      business_name: c.business_name,
      status: c.status,
      plan: c.plan,
      monthly_revenue: c.monthly_revenue,
      contact_name: c.contact_name,
      contact_email: c.contact_email
    }));
  });
}

async function get_dashboard_stats() {
  return callWithRetry(async (client) => {
    const [leads, clients] = await Promise.all([
      client.entities.Lead.list('-created_date', 500),
      client.entities.Client.list('-created_date', 500)
    ]);

    const leadsByStatus = {};
    for (const l of leads) leadsByStatus[l.status] = (leadsByStatus[l.status] || 0) + 1;

    const clientsByStatus = {};
    let mrr = 0;
    for (const c of clients) {
      clientsByStatus[c.status] = (clientsByStatus[c.status] || 0) + 1;
      if (c.status === 'active') mrr += Number(c.monthly_revenue) || 0;
    }

    return {
      total_leads: leads.length,
      leads_by_status: leadsByStatus,
      total_clients: clients.length,
      clients_by_status: clientsByStatus,
      monthly_recurring_revenue: mrr
    };
  });
}

async function list_proposals({ limit } = {}) {
  return callWithRetry(async (client) => {
    const proposals = await client.entities.Proposal.list('-created_date', limit || 10);
    return proposals.map((p) => ({
      id: p.id,
      business_name: p.business_name,
      status: p.status,
      created_date: p.created_date
    }));
  });
}

// Saves scraped leads into the CRM, skipping any that already exist by
// business_name + city so re-running a scrape doesn't create duplicates.
async function saveLeadsToCrm(client, leads) {
  const existing = await client.entities.Lead.list('-created_date', 500);
  const existingKeys = new Set(existing.map((l) => `${l.business_name}|${l.city}`.toLowerCase()));

  let savedCount = 0;
  for (const lead of leads) {
    const key = `${lead.business_name}|${lead.city}`.toLowerCase();
    if (existingKeys.has(key)) continue;
    await client.entities.Lead.create(lead);
    existingKeys.add(key);
    savedCount++;
  }
  return savedCount;
}

async function scrape_website_leads({ industry, city, limit, save_to_crm = true } = {}) {
  return callWithRetry(async (client) => {
    const result = await client.functions.invoke('scrapeWebsiteLeads', { industry, city, limit });
    if (result?.error) return { error: result.error };

    const leads = result.leads || [];
    let saved = 0;
    if (save_to_crm && leads.length) saved = await saveLeadsToCrm(client, leads);

    return {
      leads: leads.map((l) => ({
        business_name: l.business_name,
        phone: l.phone,
        address: l.address,
        rating: l.rating,
        review_count: l.review_count
      })),
      no_website_count: result.no_website_count,
      total_places_checked: result.total_found,
      saved_to_crm: save_to_crm ? saved : 0
    };
  });
}

async function scrape_receptionist_leads({ industry, city, limit, save_to_crm = true } = {}) {
  return callWithRetry(async (client) => {
    const result = await client.functions.invoke('scrapeLeads', { industry, city, limit });
    if (result?.error) return { error: result.error };

    const leads = result.leads || [];
    let saved = 0;
    if (save_to_crm && leads.length) saved = await saveLeadsToCrm(client, leads);

    return {
      leads: leads.map((l) => ({
        business_name: l.business_name,
        website: l.website,
        phone: l.phone,
        rating: l.rating,
        review_count: l.review_count
      })),
      with_website_count: result.with_website_count,
      total_places_checked: result.total_found,
      saved_to_crm: save_to_crm ? saved : 0
    };
  });
}

const handlers = {
  list_leads,
  create_lead,
  update_lead_status,
  list_clients,
  get_dashboard_stats,
  list_proposals,
  scrape_website_leads,
  scrape_receptionist_leads
};

module.exports = { declarations, handlers };