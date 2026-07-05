// The Svix-style HMAC webhook verifier is channel-generic (Resend and other
// providers sign this way), so it lives in `../webhook`; re-exported here for the
// email channel's existing callers.
export {
	signWebhookPayload,
	verifyWebhookSignature,
	WEBHOOK_TOLERANCE_SECONDS,
	type WebhookHeaders,
} from '../webhook';
