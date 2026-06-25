import { describe, expect, it, vi } from 'vitest';
import { fetchAddressSuggestions, type PlacesFetch } from './places';

function placesResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		json: async () => body,
	};
}

const SAMPLE = {
	suggestions: [
		{ placePrediction: { placeId: 'p1', text: { text: '1658 Federal Ave E, Seattle, WA' } } },
		{ placePrediction: { placeId: 'p2', text: { text: '1658 Federal Way, Federal Way, WA' } } },
	],
};

describe('fetchAddressSuggestions', () => {
	it('returns [] for input shorter than the minimum without calling fetch', async () => {
		const fetchImpl = vi.fn<PlacesFetch>();
		expect(await fetchAddressSuggestions('16', { apiKey: 'k', fetchImpl })).toEqual([]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('maps Google predictions into {placeId, description}', async () => {
		const fetchImpl = vi.fn<PlacesFetch>().mockResolvedValue(placesResponse(SAMPLE));

		const result = await fetchAddressSuggestions('1658 Federal', { apiKey: 'k', fetchImpl });

		expect(result).toEqual([
			{ placeId: 'p1', description: '1658 Federal Ave E, Seattle, WA' },
			{ placeId: 'p2', description: '1658 Federal Way, Federal Way, WA' },
		]);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
		expect(init.headers['X-Goog-Api-Key']).toBe('k');
		expect(JSON.parse(init.body)).toEqual({ input: '1658 Federal' });
	});

	it('throws when Google responds non-2xx', async () => {
		const fetchImpl = vi
			.fn<PlacesFetch>()
			.mockResolvedValue(placesResponse({}, { ok: false, status: 403 }));

		await expect(
			fetchAddressSuggestions('1658 Federal', { apiKey: 'k', fetchImpl }),
		).rejects.toThrow(/403/);
	});

	it('returns [] when the body is malformed or empty', async () => {
		const fetchImpl = vi.fn<PlacesFetch>().mockResolvedValue(placesResponse({ unexpected: true }));
		expect(await fetchAddressSuggestions('1658 Federal', { apiKey: 'k', fetchImpl })).toEqual([]);
	});

	it('skips entries that have no placePrediction', async () => {
		const fetchImpl = vi.fn<PlacesFetch>().mockResolvedValue(
			placesResponse({
				suggestions: [{ queryPrediction: {} }, SAMPLE.suggestions[0]],
			}),
		);
		const result = await fetchAddressSuggestions('1658 Federal', { apiKey: 'k', fetchImpl });
		expect(result).toEqual([{ placeId: 'p1', description: '1658 Federal Ave E, Seattle, WA' }]);
	});
});
