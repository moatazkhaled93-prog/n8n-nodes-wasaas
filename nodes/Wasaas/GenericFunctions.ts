import type {
	IExecuteFunctions,
	IHttpRequestMethods,
	IDataObject,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/**
 * Thin wrapper around n8n's generic HTTP helper, scoped to Wasaas's real
 * /api/v1 surface (see src/app/api/v1/**\/route.ts and public/openapi.json
 * in the moatazkhaled93-prog/whatsapp-saas repo). Every v1 route returns a
 * JSON body shaped either as the requested data, or `{ error, details? }`
 * (see components.schemas.Error in openapi.json) on failure, so error
 * messages below are built from that real shape rather than a generic
 * "request failed".
 */
export async function wasaasApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<any> {
	const credentials = await this.getCredentials('wasaasApi');
	const baseUrl = ((credentials.baseUrl as string) || 'https://wasaas.org/api/v1').replace(/\/+$/, '');

	const options = {
		method,
		body,
		qs,
		url: `${baseUrl}${endpoint}`,
		json: true,
	};

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'wasaasApi', options);
	} catch (error) {
		throw describeWasaasError.call(this, error as JsonObject, endpoint);
	}
}

/**
 * Wasaas's real failure modes, mapped to the exact codes/messages its
 * routes send today (verified against the route handlers, not guessed):
 *   401 -> "Invalid API key"                 (every v1 route)
 *   404 -> "Session not found"               (messages/check-number/incoming)
 *   429 -> "Message quota exceeded" | "API call quota exceeded"
 *   400 -> "Invalid input" + zod `details`
 * There is no Retry-After header or documented backoff (confirmed against
 * src/lib/rate-limit.ts, an in-memory limiter) so a 429 is reported as a
 * plan/quota problem, not a transient rate limit to blindly retry.
 */
function describeWasaasError(this: IExecuteFunctions | ILoadOptionsFunctions, error: JsonObject, endpoint: string) {
	const response = (error as { response?: { body?: IDataObject; statusCode?: number }; statusCode?: number }).response;
	const statusCode = response?.statusCode ?? (error as { statusCode?: number }).statusCode;
	const responseBody = (response?.body ?? {}) as IDataObject;
	const apiMessage = (responseBody.error as string) || (responseBody.detail as string);

	let message: string;
	switch (statusCode) {
		case 401:
			message =
				'Wasaas rejected this API key (401 Invalid API key). Re-check the key in the Wasaas API credential, or create a new one from the Wasaas dashboard → API Keys — the previous one may have been revoked or the account suspended.';
			break;
		case 404:
			message = `Wasaas could not find that session (404). Double-check the Session ID against GET ${'{{baseUrl}}'}/sessions — it must be an active session on this account, e.g. "customer-5-1".`;
			break;
		case 429:
			message = `Wasaas quota exceeded (429${apiMessage ? `: ${apiMessage}` : ''}). This account's monthly message or API-call quota has been used up for its current plan — upgrade the plan or wait for the quota to reset. This is not a transient rate limit, so immediate retries will keep failing.`;
			break;
		case 400:
			message = `Wasaas rejected the request as invalid (400${apiMessage ? `: ${apiMessage}` : ''}). Check required fields for ${endpoint} (session_id, recipient number format, message length, etc.).`;
			break;
		default:
			message = apiMessage || `Wasaas request to ${endpoint} failed${statusCode ? ` (HTTP ${statusCode})` : ''}.`;
	}

	return new NodeApiError(this.getNode(), error, { message, description: apiMessage });
}
