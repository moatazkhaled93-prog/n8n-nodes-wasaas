import type {
	IWebhookFunctions,
	IWebhookResponseData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Wasaas webhooks shipped to production (confirmed live against
 * https://wasaas.org/docs#webhooks and public/openapi.json as of 2026-11).
 * This node receives Wasaas's real signed delivery:
 *
 *   POST <your n8n webhook URL>
 *   Headers:
 *     X-Wasaas-Event:      e.g. "message.received"
 *     X-Wasaas-Delivery:   same value as payload.id — use as idempotency key
 *     X-Wasaas-Signature:  "t=<unix_timestamp>,v1=<hex_hmac_sha256>"
 *   Body (envelope):
 *     {
 *       "id": "3f2a2e9e-...-unique-per-event",
 *       "type": "message.received" | "message.status" | "session.status_changed",
 *       "created_at": "2026-11-08T12:00:00.000Z",
 *       "data": { ... event-specific fields ... }
 *     }
 *
 * The signature is HMAC-SHA256 of `${timestamp}.${rawRequestBody}` using the
 * per-webhook signing secret shown once when the webhook is created in the
 * Wasaas dashboard (Customer → Webhooks). Paste that secret into this node's
 * "Webhook Signing Secret" field to get verified, replay-guarded delivery;
 * leave it blank to accept payloads unverified (not recommended in
 * production, but useful while testing against a forwarded/manual payload).
 *
 * Wasaas also sends one `endpoint.verification` event immediately when the
 * webhook is first registered, and requires a 2xx reply within 6 seconds —
 * this node's `responseMode: onReceived` replies before running the
 * workflow, which satisfies that check automatically.
 */
export class WasaasTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wasaas Trigger',
		name: 'wasaasTrigger',
		icon: 'file:wasaas.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["eventFilter"].join(", ") || "All events"}}',
		description:
			"Starts the workflow on a real Wasaas webhook event (message.received, message.status, session.status_changed). Webhooks are live in production — register this node's Production URL as a webhook in the Wasaas dashboard.",
		defaults: { name: 'Wasaas Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'wasaas',
			},
		],
		properties: [
			{
				displayName:
					'Register this node\'s Production URL (shown above once this workflow is active) as a webhook in the Wasaas dashboard under Customer → Webhooks. Wasaas will immediately send a test "endpoint.verification" event and requires a 2xx reply within 6 seconds — this node handles that automatically. The signing secret is shown only once, at webhook creation — paste it below to verify delivery.',
				name: 'liveNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Webhook Signing Secret',
				name: 'webhookSecret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'The per-webhook signing secret from the Wasaas dashboard (shown once at creation). When set, every delivery\'s X-Wasaas-Signature header is verified (HMAC-SHA256, constant-time compare) before the workflow runs, and requests older than 5 minutes or with a bad signature are rejected with 401. Leave blank to skip verification.',
			},
			{
				displayName: 'Event Filter',
				name: 'eventFilter',
				type: 'multiOptions',
				default: [],
				description:
					'Only pass through these event types (matched against the payload\'s "type" field). Leave empty to pass through everything, including the one-time "endpoint.verification" ping sent when the webhook is registered.',
				options: [
					{ name: 'message.received', value: 'message.received' },
					{ name: 'message.status', value: 'message.status' },
					{ name: 'session.status_changed', value: 'session.status_changed' },
					{ name: 'endpoint.verification', value: 'endpoint.verification' },
				],
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData() as IDataObject;
		const headerData = this.getHeaderData();
		const secret = this.getNodeParameter('webhookSecret', '') as string;

		if (secret) {
			const signatureHeader = (headerData['x-wasaas-signature'] as string) || '';
			const req = this.getRequestObject() as unknown as { rawBody?: Buffer };
			// n8n populates req.rawBody with the exact bytes received, which is
			// required here since Wasaas signs the raw JSON string, not the
			// re-serialized object (whitespace/key order would break the HMAC).
			const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(bodyData);

			if (!verifyWasaasSignature(secret, rawBody, signatureHeader)) {
				const res = this.getResponseObject();
				res.status(401).json({ error: 'invalid_signature' });
				return { noWebhookResponse: true };
			}
		}

		const eventType = (bodyData.type as string) ?? undefined;
		const eventFilter = this.getNodeParameter('eventFilter', []) as string[];

		if (eventFilter.length > 0 && (!eventType || !eventFilter.includes(eventType))) {
			// Acknowledge receipt (2xx, required within 6s for endpoint.verification)
			// but don't fire the workflow for a filtered-out event.
			return { workflowData: undefined };
		}

		return {
			workflowData: [this.helpers.returnJsonArray([bodyData])],
		};
	}
}

/**
 * Verifies Wasaas's `X-Wasaas-Signature: t=<unix_ts>,v1=<hex_hmac>` header
 * against HMAC-SHA256(`${t}.${rawBody}`, secret), matching the real
 * production implementation documented at https://wasaas.org/docs#webhooks.
 * Rejects signatures older than 5 minutes to guard against replay.
 */
function verifyWasaasSignature(
	secret: string,
	rawBody: string,
	signatureHeader: string,
	toleranceSeconds = 300,
): boolean {
	const parts = Object.fromEntries(
		signatureHeader
			.split(',')
			.map((kv) => kv.split('=') as [string, string])
			.filter((kv) => kv.length === 2),
	);

	const timestamp = Number(parts.t);
	if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
		return false;
	}

	const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

	const expectedBuffer = Buffer.from(expected, 'hex');
	const receivedBuffer = Buffer.from(parts.v1 || '', 'hex');

	return (
		expectedBuffer.length === receivedBuffer.length &&
		timingSafeEqual(expectedBuffer, receivedBuffer)
	);
}
