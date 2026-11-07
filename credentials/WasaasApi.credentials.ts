import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Wasaas (wasaas.org) authenticates every /api/v1/* request with a static
 * API key, sent as `Authorization: Bearer wsa_...`. There is no separate
 * client id / secret pair and no OAuth flow exposed for this integration,
 * so a single "API Key" field is all that is needed.
 *
 * Get the key from the Wasaas dashboard: Dashboard -> API Keys -> Create
 * API Key. Keys look like `wsa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` and are
 * shown only once at creation time.
 */
export class WasaasApi implements ICredentialType {
	name = 'wasaasApi';

	displayName = 'Wasaas API';

	documentationUrl = 'https://wasaas.org/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Wasaas API key (starts with "wsa_"). Create one in the Wasaas dashboard under API Keys.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://wasaas.org/api/v1',
			required: true,
			description:
				'Wasaas API base URL. Only change this if you run a self-hosted or white-labelled Wasaas instance.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// GET /sessions is the cheapest authenticated endpoint on the real API
	// (src/app/api/v1/sessions/route.ts) — it costs no message/API-call
	// quota and exists purely to list the caller's WhatsApp sessions, so
	// it doubles as a safe credential test.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/sessions',
			method: 'GET',
		},
	};
}
