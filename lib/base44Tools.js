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
    loginPromise = client.auth.loginViaEmailPassword(
      process.env.BASE44_EMAIL,
      process.env.BASE44_PASSWORD
    );
  }
  await loginPromise;
  return base44;
}

async function callWithRetry(fn) {
  await ensureLoggedIn();
  try {
    return await fn(base44);
  } catch (err) {
    if (err?.response?.status === 401) {
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

const handlers = {
  list_leads,
  create_lead,
  update_lead_status,
  list_clients,
  get_dashboard_stats,
  list_proposals
};

module.exports = { declarations, handlers };
