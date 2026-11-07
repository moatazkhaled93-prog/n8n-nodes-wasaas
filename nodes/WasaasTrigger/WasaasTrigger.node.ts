import type {
	IWebhookFunctions,
	IWebhookResponseData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

/**
 * IMPORTANT — READ BEFORE RELYING ON THIS NODE IN PRODUCTION
 * ===============================================================
 * As of this package's build date, Wasaas (wasaas.org) does NOT deliver
 * webhook events to customer endpoints. This was verified directly against
 * the moatazkhaled93-prog/whatsapp-saas source:
 *   - src/lib/webhooks-disabled.ts: `WEBHOOK_DELIVERY_IMPLEMENTED = false`
 *   - docs/WEBHOOK-STATUS.md: "No component sends an event to a customer
 *     endpoint. ... No webhook dispatcher currently exists."
 *   - POST /api/webhooks and PUT /api/webhooks/[id] return 501
 *     webhook_delivery_unavailable; only GET (list) and DELETE still work.
 *
 * This node is therefore shipped as a standard n8n Webhook-style trigger,
 * built against the payload envelope and event names Wasaas's own
 * (now-removed) marketing copy and dashboard event picker described
 * (`message.sent`, `message.failed`, `session.connected`,
 * `session.disconnected`, `session.qr_ready`, envelope
 * `{ event, timestamp, data }`) so that workflows built against it keep
 * working unchanged the day Wasaas ships a real dispatcher. Until then, no
 * data will ever arrive here from Wasaas on its own.
 *
 * Until Wasaas implements delivery, use this node only for:
 *   - Manually/forwarded test payloads shaped like the documented envelope.
 *   - Receiving events from Wasaas's existing INBOUND paths that genuinely
 *     exist today (e.g. your own reverse proxy/log shipper forwarding
 *     `POST /api/v1/incoming` traffic, or a custom relay you build and
 *     control — Wasaas itself will not call this URL).
 *   - As the target of Example Workflow 3 (generic inbound webhook), where
 *     the inbound call comes from something other than Wasaas.
 */
export class WasaasTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wasaas Trigger',
		name: 'wasaasTrigger',
		icon: 'file:wasaas.svg',
		group: ['trigger'],
		version: 1,
		subtitle: 'NOT YET LIVE — see Notice',
		description:
			'Receives Wasaas-shaped webhook events. Wasaas does not deliver webhooks yet (see node notice) — this is prepared for that feature and useful today for relayed/forwarded payloads.',
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
					'Heads up: Wasaas does not currently deliver webhook events to customer endpoints (confirmed against the live whatsapp-saas source, docs/WEBHOOK-STATUS.md — no dispatcher exists yet). This trigger will not receive anything from Wasaas until that ships. It is built against Wasaas’s documented event envelope so existing workflows keep working once it does, and can be used today to receive forwarded/relayed payloads shaped the same way.',
				name: 'notLiveNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Event Filter',
				name: 'eventFilter',
				type: 'multiOptions',
				default: [],
				description:
					'Only pass through these event types (matched against the payload’s "event" field). Leave empty to pass through everything. Options reflect Wasaas’s dashboard webhook event picker.',
				options: [
					{ name: 'message.sent', value: 'message.sent' },
					{ name: 'message.failed', value: 'message.failed' },
					{ name: 'session.connected', value: 'session.connected' },
					{ name: 'session.disconnected', value: 'session.disconnected' },
					{ name: 'session.qr_ready', value: 'session.qr_ready' },
				],
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData() as IDataObject;
		const eventFilter = this.getNodeParameter('eventFilter', []) as string[];

		const eventName = (bodyData.event as string) ?? undefined;

		if (eventFilter.length > 0 && (!eventName || !eventFilter.includes(eventName))) {
			// Acknowledge receipt but don't fire the workflow for a filtered-out event.
			return { noWebhookResponse: false, workflowData: undefined };
		}

		return {
			workflowData: [this.helpers.returnJsonArray([bodyData])],
		};
	}
}
