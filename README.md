# n8n-nodes-wasaas

An [n8n](https://n8n.io) community node package for [Wasaas](https://wasaas.org) — an unofficial, session-based WhatsApp API. Send text/image/document/bulk WhatsApp messages, validate phone numbers, check session status, and react to real Wasaas webhooks (signed, live in production) from any n8n workflow.

> **Status: published to npm as `n8n-nodes-wasaas@0.1.0`.** Installable today via `npm install n8n-nodes-wasaas` or n8n's Community Nodes installer. It is **not yet listed in n8n's official verified community-nodes directory** — that submission is pending, and is itself blocked on a separate requirement (see [Verification](#verification-pending)).

## What this is built against

This node talks to Wasaas's real, existing public API (`https://wasaas.org/api/v1`), verified directly against the `moatazkhaled93-prog/whatsapp-saas` source and `public/openapi.json`, and against the live webhook docs at [wasaas.org/docs#webhooks](https://wasaas.org/docs#webhooks) — nothing here is a guessed or invented shape.

| Node action | Wasaas endpoint | Notes |
|---|---|---|
| Message → Send Text | `POST /messages` | |
| Message → Send Image | `POST /messages/image` | Public image URL only |
| Message → Send Document | `POST /messages/document` | Node reads an n8n binary input and base64-encodes it, since Wasaas only accepts base64, not a URL, for documents |
| Message → Send Bulk | `POST /messages/bulk` | Up to 500 recipients, Wasaas-side delay between sends |
| Session → List Sessions | `GET /sessions` | |
| Session → Check Session Status | `GET /sessions` (filtered client-side) | Wasaas has **no** single-session status endpoint on the public API — this operation lists all sessions and matches on Session ID locally |
| Session → Validate Number | `POST /check-number` | Real endpoint — "has_whatsapp" check |
| Wasaas Trigger (webhook) | Real signed webhook delivery | **Live in production** — see below |

### Webhooks are live

Wasaas ships real, signed outbound webhook delivery: three event types (`message.received`, `message.status`, `session.status_changed`), Stripe-style `X-Wasaas-Signature: t=<unix>,v1=<hmac>` signing, SSRF-protected URLs, retries with backoff, and a delivery log in the dashboard. The **Wasaas Trigger** node included here verifies that signature (HMAC-SHA256 over the raw body, constant-time compare, 5-minute replay window) when you paste in the webhook's signing secret, and emits the real envelope (`{ id, type, created_at, data }`) to the rest of your workflow. See [Credentials setup](#credentials-setup) and [Webhooks](#webhooks) below.

## Installation

```bash
npm install n8n-nodes-wasaas
```

Or in a self-hosted n8n instance: **Settings → Community Nodes → Install**, package name `n8n-nodes-wasaas`.

For local development against this repo before publishing, `npm link` it into your n8n custom-nodes directory, or copy `dist/` into `~/.n8n/custom/`.

## Credentials setup (Auth)

1. Sign up at [wasaas.org](https://wasaas.org/register) — [7-day free trial, no card](https://wasaas.org?ref=github-n8n-nodes-wasaas).
2. Go to **API Keys** and click **Create API Key**. Copy the key — it starts with `wsa_` and is shown only once.
3. In n8n, create a new credential of type **Wasaas API**:
   - **API Key**: paste the `wsa_...` key.
   - **Base URL**: leave as `https://wasaas.org/api/v1` unless you run a self-hosted/white-labelled instance.
4. Click **Test**. This calls `GET /sessions` (a free, read-only call) — a green check confirms the key is valid and active.

## Connect a WhatsApp number

Go to **Sessions → Add Session** in the Wasaas dashboard and scan the QR code with the WhatsApp number you want to send/receive from. Every action also needs this **Session ID** (e.g. `customer-5-1`) — get it from the **Session → List Sessions** operation, or from the dashboard's Sessions page. A session must be in `connected` status for sends to succeed.

## Your first message

Add a **Wasaas** node, pick **Resource: Message → Operation: Send Text**, and fill in:

| Field | Value |
|---|---|
| Session ID | `customer-5-1` |
| To | `966501234567` |
| Message | `Hello from Wasaas! 👋` |

This is equivalent to the node internally calling:

```bash
curl -X POST https://wasaas.org/api/v1/messages \
  -H "Authorization: Bearer wsa_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{ "session_id": "customer-5-1", "to": "966501234567", "message": "Hello from Wasaas!" }'
# { "success": true, "to": "966501234567", "status": "sent" }
```

## Webhooks

Add a **Wasaas Trigger** node, activate the workflow to get its Production URL, then register that URL in the Wasaas dashboard under **Customer → Webhooks**. Wasaas immediately sends a one-time `endpoint.verification` ping (the node acknowledges it automatically) and shows you a signing secret **once** — paste it into the node's **Webhook Signing Secret** field so every delivery is verified before your workflow runs:

```ts
// What the node does under the hood (nodes/WasaasTrigger/WasaasTrigger.node.ts)
import { createHmac, timingSafeEqual } from 'crypto';

function verifyWasaasSignature(secret: string, rawBody: string, header: string, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.v1 || '', 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Each delivery's `data` arrives in the node's output exactly as sent, inside the real envelope:

```json
{
  "id": "3f2a2e9e-...-unique-per-event",
  "type": "message.status",
  "created_at": "2026-11-08T12:00:00.000Z",
  "data": { "session_id": "customer-5-1", "to": "966501234567", "status": "sent" }
}
```

Use `id` as your idempotency key — Wasaas retries a failed delivery up to 5 times with backoff, and the same `id` is reused on every retry of the same event. Use the node's **Event Filter** to only run the workflow for specific event types.

## Get started

**[Free 7-day trial, no card required →](https://wasaas.org?ref=github-n8n-nodes-wasaas)**

Full API reference, rate limits, error codes and the webhook spec: **[wasaas.org/docs](https://wasaas.org/docs)**

## Error handling

The node maps Wasaas's real error responses to actionable messages instead of a bare HTTP code:

- **401** → API key invalid/revoked — points you back to the dashboard to issue a new one.
- **404** → Session not found — the Session ID doesn't belong to this account or was mistyped.
- **429** → Monthly message or API-call quota exceeded for the account's plan. Wasaas has no documented retry/back-off or `Retry-After` header for this, so it is reported as a quota problem, not a transient rate limit to blindly retry.
- **400** → Invalid input, with Wasaas's field-level validation details surfaced.

Enable **Continue On Fail** on the node to route failures to a separate output branch instead of stopping the workflow (see Example 1).

## Example workflows

All three live in [`examples/`](./examples) as importable n8n workflow JSON (**Workflows → Import from File** in n8n). They were built and reviewed statically against real n8n node-type names and the actions above; there was no live n8n instance in the environment they were built in to execute them end-to-end, so treat them as verified-by-inspection starting points, not load-tested flows.

1. **[Form submission → WhatsApp confirmation](./examples/1-form-to-whatsapp-confirmation.json)** — n8n Form Trigger collects a name + WhatsApp number, sends a text confirmation, and alerts an ops number on failure.
2. **[CRM new-lead webhook → WhatsApp to lead](./examples/2-crm-lead-to-whatsapp.json)** — a CRM's outgoing webhook posts a new lead, the number is normalised and validated with `check-number` before sending, and the CRM gets a JSON response back.
3. **[Generic inbound webhook → WhatsApp notification](./examples/3-generic-webhook-to-whatsapp-notification.json)** — any third-party webhook (monitoring, payments, another automation tool) triggers a WhatsApp alert to a fixed number. For a webhook coming from Wasaas itself, use the **Wasaas Trigger** node instead (see [Webhooks](#webhooks) above).

## Screenshots

No GUI environment was available to render n8n and capture real screenshots in this session, so the node layout is described instead:

- **Wasaas node**: two top-level dropdowns, **Resource** (`Message` / `Session`) and **Operation**, which changes the fields below it — e.g. picking `Message → Send Text` shows Session ID, To, Message; picking `Session → Validate Number` shows Session ID and Phone Number.
- **Wasaas Trigger node**: a single webhook-style trigger node with a Notice box at the top explaining how to register its Production URL in the Wasaas dashboard, a **Webhook Signing Secret** field, and an Event Filter multi-select below it.
- **Credential dialog**: two fields, API Key (masked) and Base URL (pre-filled), with a Test button.

## Verification (pending)

`n8n-nodes-wasaas@0.1.0` is published and installable, but not yet submitted for n8n's official "verified community node" badge (unverified nodes are still fully installable and usable — verification only adds in-editor discoverability and the checkmark). A creator-portal account has been registered for submission; actually submitting is blocked on one real gap:

- n8n requires packages submitted for verification (as of May 1, 2026) to be published from a GitHub Action with npm provenance, not a local `npm publish` — see [npm's provenance docs](https://docs.npmjs.com/generating-provenance-statements). `0.1.0` was published directly (`npm whoami` / local session), so it does **not** carry a provenance attestation (`npm view n8n-nodes-wasaas` shows no `dist.attestations`). A future release published via a GitHub Actions workflow with `id-token: write` and `npm publish --provenance` would satisfy this for the next version.

Nothing in this README or `package.json` claims "official n8n node" / verified status, and it should stay that way until verification is actually completed and confirmed by n8n.

## License

MIT
