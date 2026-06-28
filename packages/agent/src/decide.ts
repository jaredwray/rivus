import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { lastUserMessage } from './conversation';
import { type CompanyField, type Intent, resolveIntent } from './intent';
import type { ChatMessage, Env } from './types';

/**
 * The agent's "understanding" layer. Given the whole conversation, it decides
 * *which of the agent's tools to use* — read company facts, browse or search the
 * knowledge base, answer a question from it, or add/update an FAQ — and with what
 * arguments. The chosen action is then carried out by `assistant.ts` against the
 * Rivus API.
 *
 * When a model is configured the model makes that decision, so it reasons over the
 * full chat (a bare "what should I add?" after looking at the FAQs is understood),
 * and tells a *question* apart from a *command* ("how do I create an invoice?" is
 * answered from the knowledge base, not turned into a new FAQ). When no model is
 * configured — or a model call fails — it degrades to the deterministic, rule-based
 * `resolveIntent`, so the agent always understands *something* without a network
 * round-trip. This is the single seam the README points at: the agent's routing
 * lives here and nowhere else.
 */

/** The company fields the model may ask for, kept in sync with {@link CompanyField}. */
const COMPANY_FIELDS = [
	'name',
	'website',
	'phone',
	'address',
	'timezone',
	'slug',
	'status',
] as const satisfies readonly CompanyField[];

/**
 * The structured decision the model returns: one action (the tool to use) plus the
 * arguments it needs. Every argument is optional with a safe default so a terse
 * model response still validates; {@link decisionToIntent} turns it into the
 * `Intent` the assistant already knows how to execute.
 */
const decisionSchema = z.object({
	action: z.enum([
		'greeting',
		'help',
		'company_info',
		'faq_list',
		'faq_search',
		'faq_answer',
		'faq_create',
		'faq_update',
		'unknown',
	]),
	/** For `company_info`: which fields to report (empty = the whole record). */
	fields: z.array(z.enum(COMPANY_FIELDS)).default([]),
	/** For `faq_search`: what to search the knowledge base for. */
	query: z.string().default(''),
	/** For `faq_answer`: the question to answer from the knowledge base. */
	answerQuestion: z.string().default(''),
	/** For `faq_create`/`faq_update`: the FAQ's question/topic and answer text. */
	question: z.string().nullable().default(null),
	answer: z.string().nullable().default(null),
	topic: z.string().default(''),
});

export type AgentDecision = z.infer<typeof decisionSchema>;

/** Decides the agent's action for a conversation. */
export type Decide = (messages: ChatMessage[]) => Promise<Intent>;

/**
 * The single AI call this layer makes, narrowed to what we use. Injectable so tests
 * drive the routing without a model or the network — the same seam `@rivus/api`'s
 * FAQ answerer uses. Defaults to the AI SDK's {@link generateObject}.
 */
export type GenerateDecisionFn = (options: {
	model: LanguageModel;
	schema: typeof decisionSchema;
	system: string;
	prompt: string;
	maxOutputTokens?: number;
}) => Promise<{ object: AgentDecision }>;

const defaultGenerateDecision: GenerateDecisionFn = async (options) => {
	const { object } = await generateObject({
		model: options.model,
		schema: options.schema,
		schemaName: 'agent_decision',
		system: options.system,
		prompt: options.prompt,
		maxOutputTokens: options.maxOutputTokens,
	});
	return { object };
};

/** Keep the routing call small and fast — it only picks an action, never composes prose. */
const MAX_OUTPUT_TOKENS = 300;

const SYSTEM = [
	'You are the router for Rivus, an assistant for a small business. Decide the single',
	'best action to take for the latest user message, using the whole conversation for',
	'context. Reply with the structured decision only — you never write the user-facing',
	'text yourself.',
	'',
	'Actions:',
	'- greeting: the user is just saying hello.',
	'- help: the user asks what you can do.',
	'- company_info: the user wants company/account facts (name, website, phone, address,',
	'  timezone, slug, status). Put the specific fields in `fields`, or leave it empty for',
	'  the whole record.',
	'- faq_list: the user wants to browse/see their knowledge base (their FAQs).',
	'- faq_search: the user wants to find FAQs on a topic. Put the topic in `query`.',
	'- faq_answer: the user asks a QUESTION they want answered from the knowledge base.',
	'  This is the default for any genuine question, even one containing words like',
	'  "create"/"add"/"make" (e.g. "how do I create an invoice?" is a question, not a',
	'  request to add an FAQ). Put the question in `answerQuestion`.',
	'- faq_create: the user explicitly asks to ADD a new FAQ. Only choose this when they',
	'  clearly want to create one. Put the FAQ wording in `question` and `answer` (use null',
	'  for whichever they did not give).',
	'- faq_update: the user explicitly asks to CHANGE an existing FAQ. Put the FAQ topic in',
	'  `topic` and the new text in `answer` (null if not given).',
	'- unknown: none of the above and not a knowledge-base question.',
	'',
	'Resolve follow-ups from context: after looking at the FAQs, "what should I add?" means',
	'faq_create with no question/answer yet; "anything about refunds?" means faq_search.',
	'Prefer faq_answer over faq_create whenever the user is asking rather than commanding.',
].join('\n');

/** Render the transcript for the prompt, tagging each turn with its role. */
function transcript(messages: ChatMessage[]): string {
	const ROLE_LABEL: Record<ChatMessage['role'], string> = {
		user: 'User',
		assistant: 'Assistant',
		system: 'System',
	};
	return messages.map((message) => `${ROLE_LABEL[message.role]}: ${message.content}`).join('\n');
}

/** Map a validated model decision onto the `Intent` the assistant executes. */
export function decisionToIntent(decision: AgentDecision, latestUserText: string): Intent {
	switch (decision.action) {
		case 'greeting':
			return { kind: 'greeting' };
		case 'help':
			return { kind: 'help' };
		case 'company_info':
			return { kind: 'company_info', fields: decision.fields };
		case 'faq_list':
			return { kind: 'faq_list' };
		case 'faq_search':
			// A search with no subject is really just "show me the FAQs".
			return decision.query.trim().length > 0
				? { kind: 'faq_search', query: decision.query.trim() }
				: { kind: 'faq_list' };
		case 'faq_answer': {
			// Fall back to the raw user text when the model didn't restate the question.
			const question = decision.answerQuestion.trim() || latestUserText;
			return { kind: 'faq_answer', question };
		}
		case 'faq_create':
			return { kind: 'faq_create', question: decision.question, answer: decision.answer };
		case 'faq_update':
			return { kind: 'faq_update', topic: decision.topic, answer: decision.answer };
		default:
			return { kind: 'unknown' };
	}
}

export interface DecideDeps {
	/** The model to route with; when absent, routing is purely deterministic. */
	model?: LanguageModel;
	/** Injected for tests; defaults to the AI SDK's structured generation. */
	generate?: GenerateDecisionFn;
	/** Surfaced so a failed model call is visible in production logs. */
	logger?: { warn(message: string): void };
}

/**
 * Build the agent's decider. With a model it asks the model to choose the action,
 * falling back to {@link resolveIntent} if the call fails; with no model it *is*
 * {@link resolveIntent}. Either way it returns an `Intent` the assistant executes,
 * so the rest of the agent is unchanged whether or not a model is configured.
 */
export function createDecider(deps: DecideDeps = {}): Decide {
	const { model, generate = defaultGenerateDecision, logger } = deps;
	return async (messages) => {
		if (!model) {
			return resolveIntent(messages);
		}
		const latestUserText = lastUserMessage(messages) ?? '';
		try {
			const { object } = await generate({
				model,
				schema: decisionSchema,
				system: SYSTEM,
				prompt: transcript(messages),
				maxOutputTokens: MAX_OUTPUT_TOKENS,
			});
			return decisionToIntent(object, latestUserText);
		} catch (error) {
			// A model outage must never break the chat: log it and fall back to the
			// deterministic understanding, exactly as the API's answerer degrades.
			logger?.warn(`Agent routing failed, falling back to rule-based intent — ${String(error)}`);
			return resolveIntent(messages);
		}
	};
}

/** Default routing model, overridable per environment via `ANTHROPIC_MODEL`. */
const DEFAULT_MODEL = 'claude-haiku-4-5';

/**
 * Wire a decider from the Worker environment. When `ANTHROPIC_API_KEY` is set the
 * agent routes with the model; otherwise it routes deterministically. Mirrors the
 * API's provider wiring (and its graceful no-key degradation).
 */
export function createDeciderFromEnv(env: Env): Decide {
	if (!env.ANTHROPIC_API_KEY) {
		return createDecider();
	}
	const model = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(
		env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
	);
	return createDecider({ model, logger: console });
}
