import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { wasaasApiRequest } from './GenericFunctions';

export class Wasaas implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wasaas',
		name: 'wasaas',
		icon: 'file:wasaas.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send WhatsApp messages and manage sessions through Wasaas (wasaas.org)',
		defaults: { name: 'Wasaas' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'wasaasApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Message', value: 'message' },
					{ name: 'Session', value: 'session' },
				],
				default: 'message',
			},

			// ---------------- Message operations ----------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{
						name: 'Send Text',
						value: 'sendText',
						description: 'Send a plain text WhatsApp message (POST /messages)',
						action: 'Send a text message',
					},
					{
						name: 'Send Image',
						value: 'sendImage',
						description: 'Send an image by public URL (POST /messages/image)',
						action: 'Send an image message',
					},
					{
						name: 'Send Document',
						value: 'sendDocument',
						description: 'Send a file as base64 (POST /messages/document)',
						action: 'Send a document message',
					},
					{
						name: 'Send Bulk',
						value: 'sendBulk',
						description: 'Send one message to up to 500 recipients (POST /messages/bulk)',
						action: 'Send a bulk message',
					},
				],
				default: 'sendText',
			},

			// ---------------- Session operations ----------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['session'] } },
				options: [
					{
						name: 'List Sessions',
						value: 'listSessions',
						description: "List every WhatsApp session on this account (GET /sessions)",
						action: 'List sessions',
					},
					{
						name: 'Check Session Status',
						value: 'checkStatus',
						description:
							'Look up one session’s connection status. Wasaas has no single-session status endpoint on the public API, so this calls GET /sessions and filters client-side by Session ID.',
						action: 'Check session status',
					},
					{
						name: 'Validate Number',
						value: 'validateNumber',
						description: 'Check whether a phone number has an active WhatsApp account (POST /check-number)',
						action: 'Validate a phone number',
					},
				],
				default: 'listSessions',
			},

			// ---------------- shared: Session ID ----------------
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'customer-5-1',
				description: 'The Wasaas session ID to use, from the List Sessions operation',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendText', 'sendImage', 'sendDocument', 'sendBulk'],
					},
				},
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'customer-5-1',
				description: 'The Wasaas session ID to check or validate against',
				displayOptions: {
					show: {
						resource: ['session'],
						operation: ['checkStatus', 'validateNumber'],
					},
				},
			},

			// ---------------- Send Text ----------------
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				default: '',
				required: true,
				placeholder: '966501234567',
				description: 'Recipient phone number, digits only with country code (no +, spaces or leading 0)',
				displayOptions: { show: { resource: ['message'], operation: ['sendText', 'sendImage', 'sendDocument'] } },
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				description: 'Text to send (max 4096 characters)',
				displayOptions: { show: { resource: ['message'], operation: ['sendText'] } },
			},

			// ---------------- Send Image ----------------
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				required: true,
				description: 'Public URL of the image (JPEG, PNG, GIF or WebP)',
				displayOptions: { show: { resource: ['message'], operation: ['sendImage'] } },
			},
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				default: '',
				description: 'Optional caption shown under the image',
				displayOptions: { show: { resource: ['message'], operation: ['sendImage', 'sendDocument'] } },
			},

			// ---------------- Send Document ----------------
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description:
					'Name of the input binary field containing the file to send. The node reads it and base64-encodes it for Wasaas’s POST /messages/document, which only accepts base64 content (no URL option exists for documents).',
				displayOptions: { show: { resource: ['message'], operation: ['sendDocument'] } },
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'invoice.pdf',
				displayOptions: { show: { resource: ['message'], operation: ['sendDocument'] } },
			},
			{
				displayName: 'MIME Type',
				name: 'mimeType',
				type: 'string',
				default: 'application/pdf',
				required: true,
				displayOptions: { show: { resource: ['message'], operation: ['sendDocument'] } },
			},

			// ---------------- Send Bulk ----------------
			{
				displayName: 'Recipients',
				name: 'recipients',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				placeholder: '966501234567, 966509876543',
				description: 'Comma- or newline-separated phone numbers, up to 500',
				displayOptions: { show: { resource: ['message'], operation: ['sendBulk'] } },
			},
			{
				displayName: 'Message',
				name: 'bulkMessage',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['message'], operation: ['sendBulk'] } },
			},
			{
				displayName: 'Options',
				name: 'bulkOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['sendBulk'] } },
				options: [
					{
						displayName: 'Min Delay (Seconds)',
						name: 'minDelay',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 300 },
						default: 3,
						description: 'Minimum delay between sends. Wasaas enforces 1-300s.',
					},
					{
						displayName: 'Max Delay (Seconds)',
						name: 'maxDelay',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 300 },
						default: 8,
						description: 'Maximum delay between sends. Must be ≥ Min Delay.',
					},
				],
			},

			// ---------------- Validate Number ----------------
			{
				displayName: 'Phone Number',
				name: 'phone',
				type: 'string',
				default: '',
				required: true,
				placeholder: '966501234567',
				description: 'Number to check for an active WhatsApp account',
				displayOptions: { show: { resource: ['session'], operation: ['validateNumber'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] = {};

				if (resource === 'message') {
					const sessionId = this.getNodeParameter('sessionId', i) as string;

					if (operation === 'sendText') {
						const to = this.getNodeParameter('to', i) as string;
						const message = this.getNodeParameter('message', i) as string;
						responseData = await wasaasApiRequest.call(this, 'POST', '/messages', {
							session_id: sessionId,
							to,
							message,
						});
					} else if (operation === 'sendImage') {
						const to = this.getNodeParameter('to', i) as string;
						const imageUrl = this.getNodeParameter('imageUrl', i) as string;
						const caption = this.getNodeParameter('caption', i, '') as string;
						responseData = await wasaasApiRequest.call(this, 'POST', '/messages/image', {
							session_id: sessionId,
							to,
							image_url: imageUrl,
							...(caption ? { caption } : {}),
						});
					} else if (operation === 'sendDocument') {
						const to = this.getNodeParameter('to', i) as string;
						const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
						const fileName = this.getNodeParameter('fileName', i) as string;
						const mimeType = this.getNodeParameter('mimeType', i) as string;
						const caption = this.getNodeParameter('caption', i, '') as string;

						const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

						responseData = await wasaasApiRequest.call(this, 'POST', '/messages/document', {
							session_id: sessionId,
							to,
							base64: buffer.toString('base64'),
							filename: fileName || binaryData.fileName || 'file',
							mime: mimeType || binaryData.mimeType,
							...(caption ? { caption } : {}),
						});
					} else if (operation === 'sendBulk') {
						const recipientsRaw = this.getNodeParameter('recipients', i) as string;
						const bulkMessage = this.getNodeParameter('bulkMessage', i) as string;
						const bulkOptions = this.getNodeParameter('bulkOptions', i, {}) as {
							minDelay?: number;
							maxDelay?: number;
						};
						const recipients = recipientsRaw
							.split(/[\n,]/)
							.map((n) => n.trim())
							.filter((n) => n.length > 0);

						if (recipients.length === 0) {
							throw new NodeOperationError(this.getNode(), 'No recipients provided', { itemIndex: i });
						}
						if (recipients.length > 500) {
							throw new NodeOperationError(
								this.getNode(),
								`Wasaas allows at most 500 recipients per bulk send, got ${recipients.length}`,
								{ itemIndex: i },
							);
						}

						responseData = await wasaasApiRequest.call(this, 'POST', '/messages/bulk', {
							session_id: sessionId,
							recipients,
							message: bulkMessage,
							...(bulkOptions.minDelay ? { min_delay: bulkOptions.minDelay } : {}),
							...(bulkOptions.maxDelay ? { max_delay: bulkOptions.maxDelay } : {}),
						});
					}
				} else if (resource === 'session') {
					if (operation === 'listSessions') {
						responseData = await wasaasApiRequest.call(this, 'GET', '/sessions');
					} else if (operation === 'checkStatus') {
						const sessionId = this.getNodeParameter('sessionId', i) as string;
						const sessions = (await wasaasApiRequest.call(this, 'GET', '/sessions')) as IDataObject[];
						const match = sessions.find((s) => s.session_id === sessionId);
						if (!match) {
							throw new NodeOperationError(
								this.getNode(),
								`No session with Session ID "${sessionId}" was found on this account. Wasaas has no dedicated single-session status endpoint on the public API — this operation lists GET /sessions and filters locally, so the ID must match exactly.`,
								{ itemIndex: i },
							);
						}
						responseData = match;
					} else if (operation === 'validateNumber') {
						const sessionId = this.getNodeParameter('sessionId', i) as string;
						const phone = this.getNodeParameter('phone', i) as string;
						responseData = await wasaasApiRequest.call(this, 'POST', '/check-number', {
							session_id: sessionId,
							phone,
						});
					}
				}

				const items_ = Array.isArray(responseData) ? responseData : [responseData];
				for (const item of items_) {
					returnData.push({ json: item, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
