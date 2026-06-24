import { z } from 'zod';

/**
 * Google Places Autocomplete (New) over `fetch`. Pure and RN-free so it's
 * unit-tested under Node with an injected fetch — no SDK dependency, mirroring
 * the API's Resend integration. The UI layer adds debouncing and rendering.
 */

export interface AddressSuggestion {
	/** Google place id (for an optional later Place Details lookup). */
	placeId: string;
	/** Human-readable single-line address to show and store. */
	description: string;
}

/** The slice of `fetch` we need, narrowed so tests can pass a simple fake. */
export type PlacesFetch = (
	input: string,
	init: {
		method: string;
		headers: Record<string, string>;
		body: string;
		signal?: AbortSignal;
	},
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface AutocompleteOptions {
	apiKey: string;
	fetchImpl?: PlacesFetch;
	/** Aborts an in-flight request when the user keeps typing. */
	signal?: AbortSignal;
}

const AUTOCOMPLETE_ENDPOINT = 'https://places.googleapis.com/v1/places:autocomplete';

/** Don't call the API until there's enough input to be meaningful. */
export const MIN_QUERY_LENGTH = 3;

const responseSchema = z.object({
	suggestions: z
		.array(
			z.object({
				placePrediction: z
					.object({
						placeId: z.string(),
						text: z.object({ text: z.string() }),
					})
					.optional(),
			}),
		)
		.optional(),
});

/**
 * Fetch address suggestions for `query`. Returns `[]` for short input; throws on
 * a non-2xx response. A malformed body yields `[]` rather than throwing.
 */
export async function fetchAddressSuggestions(
	query: string,
	options: AutocompleteOptions,
): Promise<AddressSuggestion[]> {
	const trimmed = query.trim();
	if (trimmed.length < MIN_QUERY_LENGTH) {
		return [];
	}
	const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as PlacesFetch);
	const response = await fetchImpl(AUTOCOMPLETE_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Goog-Api-Key': options.apiKey,
			// Ask Google to return only the fields we use, to keep the response small.
			'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
		},
		body: JSON.stringify({ input: trimmed }),
		signal: options.signal,
	});

	if (!response.ok) {
		throw new Error(`Places autocomplete failed (status ${response.status})`);
	}

	const parsed = responseSchema.safeParse(await response.json());
	if (!parsed.success || !parsed.data.suggestions) {
		return [];
	}
	return parsed.data.suggestions
		.map((entry) => entry.placePrediction)
		.filter((prediction) => prediction !== undefined)
		.map((prediction) => ({ placeId: prediction.placeId, description: prediction.text.text }));
}
