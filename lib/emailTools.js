/**
 * Email is the one tool with real-world consequences, so it's a two-step
 * flow instead of a single call:
 *
 *   1. prepare_email  — stages a draft, sends nothing, hands the draft back
 *      to the model so it can read it aloud and ask for confirmation
 *   2. confirm_pending_email / cancel_pending_email — the only two ways the
 *      staged draft ever leaves this file
 *
 * This is a factory (not a flat module like the other tool files) because
 * the pending draft has to live per-connection — two browser tabs, or a
 * phone + PC open at once, must never share or clobber each other's
 * unsent email.
 */

const nodemailer = require('nodemailer');

let mailTransport = null;
function getMailTransport() {
  if (!mailTransport) {
    mailTransport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
  }
  return mailTransport;
}

/**
 * @param {(event: object) => void} onStateChange - called with a plain
 *   object whenever the pending draft changes, so the caller (server.js)
 *   can push it to the browser for the visual confirmation card.
 */
function createEmailTools(onStateChange) {
  let pending = null; // { to, subject, body } | null

  const declarations = [
    {
      name: 'prepare_email',
      description:
        "Stage an email as a draft for the user to review. This does NOT send anything. Always call this first for any email request — never call confirm_pending_email in the same turn, even if the user sounds certain. After calling this, read the to/subject/body back to the user in your reply and explicitly ask them to confirm or cancel before anything goes out.",
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address.' },
          subject: { type: 'string' },
          body: { type: 'string', description: 'Plain-text email body.' }
        },
        required: ['to', 'subject', 'body']
      }
    },
    {
      name: 'confirm_pending_email',
      description:
        "Actually sends the currently staged draft. Only call this when the user has just clearly said to send it — 'yes send it', 'confirmed', 'go ahead', 'send'. If they said anything else, don't call this.",
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'cancel_pending_email',
      description:
        "Discards the currently staged draft without sending anything. Call this when the user says to cancel, stop, don't send it, hold off, or otherwise backs out — including if they just seem to be changing their mind.",
      parameters: { type: 'object', properties: {} }
    }
  ];

  async function prepare_email({ to, subject, body }) {
    pending = { to, subject, body };
    onStateChange?.({ type: 'pending_email', email: pending });
    return {
      status: 'drafted_awaiting_confirmation',
      to,
      subject,
      body,
      note: 'Not sent. Read this back to the user verbatim and wait for explicit confirmation or cancellation before calling anything else.'
    };
  }

  async function confirm_pending_email() {
    if (!pending) {
      return { error: 'There is no pending draft to send.' };
    }
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      return { error: 'Gmail is not configured on the server (GMAIL_USER / GMAIL_APP_PASSWORD missing).' };
    }
    const draft = pending;
    pending = null;
    try {
      const transport = getMailTransport();
      await transport.sendMail({ from: process.env.GMAIL_USER, to: draft.to, subject: draft.subject, text: draft.body });
      onStateChange?.({ type: 'email_sent', email: draft });
      return { sent: true, to: draft.to, subject: draft.subject };
    } catch (err) {
      onStateChange?.({ type: 'email_failed', email: draft, error: err.message });
      return { error: `Send failed: ${err.message}` };
    }
  }

  async function cancel_pending_email() {
    if (!pending) {
      return { cancelled: false, note: 'There was nothing pending.' };
    }
    const draft = pending;
    pending = null;
    onStateChange?.({ type: 'email_cancelled', email: draft });
    return { cancelled: true };
  }

  return {
    declarations,
    handlers: { prepare_email, confirm_pending_email, cancel_pending_email }
  };
}

module.exports = { createEmailTools };
