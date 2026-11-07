# n8n-nodes-wasaas

An [n8n](https://n8n.io) community node package for [Wasaas](https://wasaas.org) — an unofficial, session-based WhatsApp API. Send text/image/document/bulk WhatsApp messages, validate phone numbers and check session status from any n8n workflow.

> **Status: BUILT, NOT YET PUBLISHED.** This package has not been published to npm and has not gone through n8n's community-node verification. See [Publishing](#publishing-not-yet-done) for exactly what's left.

## What this is built against

This node talks to Wasaas's real, existing public API (`https://wasaas.org/api/v1`), verified directly against the `moatazkhaled93-prog/whatsapp-saas` source (`src/app/api/v1/**/route.ts`, `public/openapi.json`) — nothing here is a guessed or invented endpoint shape.

| Node action | Wasaas endpoint | Notes |
|---|---|---|
| Message → Send Text | `POST /messages` | |
| Message → Send Image | `POST /messages/image` | Public image URL only |
| Message → Send Document | `POST /messages/document` | Node reads an n8n binary input and base64-encodes it, since Wasaas only accepts base64, not a URL, for documents |
| Message → Send Bulk | `POST /messages/bulk` | Up to 500 recipients, Wasaas-side delay between sends |
| Session → List Sessions | `GET /sessions` | |
| Session → Check Session Status | `GET /sessions` (filtered client-side) | Wasaas has **no** single-session status endpoint on the public API — this operation lists all sessions and matches on Session ID locally |
| Session → Validate Number | `POST /check-number` | Real endpoint — "has_whatsapp" check |
| Wasaas Trigger (webhook) | n8n webhook, Wasaas-shaped payload | **Not live yet — see below** |

### Important: Wasaas does not deliver webhooks yet

Wasaas's dashboard lets a customer register a webhook (`name`, `url`, `events`), but as of this build, **no dispatcher exists** to actually call that URL. This was verified directly in the app source:

- `src/lib/webhooks-disabled.ts`: `WEBHOOK_DELIVERY_IMPLEMENTED = false`
- `docs/WEBHOOK-STATUS.md`: *"No component sends an event to a customer endpoint... No webhook dispatcher currently exists."*
- `POST /api/webhooks` and `PUT /api/webhooks/[id]` return `501 webhook_delivery_unavailable`

So the **Wasaas Trigger** node included here is built against the documented event envelope (`{ event, timestamp, data }`, events `message.sent` / `message.failed` / `session.connected` / `session.disconnected` / `session.qr_ready`) so workflows built on it keep working the day Wasaas ships real delivery — but **it will not receive anything from Wasaas on its own today**. The node's canvas subtitle and an in-node Notice both say this explicitly. Until then, use it to receive relayed/forwarded payloads shaped the same way (see Example 3).

## Installation

Not yet on npm — see [Publishing](#publishing-not-yet-done). Once published:

```bash
npm install n8n-nodes-wasaas
```

Or in a self-hosted n8n instance: **Settings → Community Nodes → Install**, package name `n8n-nodes-wasaas`.

For local development against this repo before publishing, `npm link` it into your n8n custom-nodes directory, or copy `dist/` into `~/.n8n/custom/`.

## Credentials setup

1. Log into your Wasaas dashboard at `https://wasaas.org`.
2. Go to **API Keys** and click **Create API Key**. Copy the key — it starts with `wsa_` and is shown only once.
3. In n8n, create a new credential of type **Wasaas API**:
   - **API Key**: paste the `wsa_...` key.
   - **Base URL**: leave as `https://wasaas.org/api/v1` unless you run a self-hosted/white-labelled instance.
4. Click **Test**. This calls `GET /sessions` (a free, read-only call) — a green check confirms the key is valid and active.

Every WhatsApp action also needs a **Session ID** (e.g. `customer-5-1`). Get it from the **Session → List Sessions** operation, or from the Wasaas dashboard's Sessions page. A session must be in `connected` status for sends to succeed.

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
3. **[Generic inbound webhook → WhatsApp notification](./examples/3-generic-webhook-to-whatsapp-notification.json)** — any third-party webhook (monitoring, payments, another automation tool) triggers a WhatsApp alert to a fixed number. This pattern is also today's practical substitute for the not-yet-live Wasaas Trigger.

## Screenshots

No GUI environment was available to render n8n and capture real screenshots in this session, so the node layout is described instead:

- **Wasaas node**: two top-level dropdowns, **Resource** (`Message` / `Session`) and **Operation**, which changes the fields below it — e.g. picking `Message → Send Text` shows Session ID, To, Message; picking `Session → Validate Number` shows Session ID and Phone Number.
- **Wasaas Trigger node**: a single webhook-style trigger node with a yellow Notice box at the top reading "Heads up: Wasaas does not currently deliver webhook events..." and an Event Filter multi-select below it.
- **Credential dialog**: two fields, API Key (masked) and Base URL (pre-filled), with a Test button.

## Publishing (not yet done)

This package has been built, type-checked (`tsc --noEmit`), compiled (`npm run build`), and linted against n8n's own community-node ESLint rules (`eslint-plugin-n8n-nodes-base`) with zero errors — but **not published**. To finish:

1. `npm login` with the Wasaas/maintainer's own npm account.
2. `npm publish` from this directory (after bumping the version past `0.1.0` if needed).
3. Submit the package for n8n's [community node verification](https://docs.n8n.io/integrations/community-nodes/) if "verified" status is wanted (optional — unverified community nodes are still installable).
4. Push this repo to its final GitHub location (currently a local, unpushed repo — see the hand-off notes for where).

Nothing in this README or `package.json` claims "official n8n node" status, and it should stay that way until step 3 is actually completed and confirmed by n8n.

## License

MIT
