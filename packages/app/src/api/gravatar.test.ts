import { gravatarUrl } from '@rivus/core';
import { describe, expect, it, vi } from 'vitest';
import { type GravatarFetch, hasGravatar } from './gravatar';

describe('hasGravatar', () => {
	it('requests the exact URL the Avatar component would render, via HEAD', async () => {
		const fetchImpl = vi.fn<GravatarFetch>().mockResolvedValue({ ok: true });
		await hasGravatar('jane@example.com', { fetchImpl });
		expect(fetchImpl).toHaveBeenCalledWith(gravatarUrl('jane@example.com'), { method: 'HEAD' });
	});

	it('returns true when Gravatar resolves the image', async () => {
		const fetchImpl = vi.fn<GravatarFetch>().mockResolvedValue({ ok: true });
		expect(await hasGravatar('jane@example.com', { fetchImpl })).toBe(true);
	});

	it('returns false when Gravatar 404s (no image set)', async () => {
		const fetchImpl = vi.fn<GravatarFetch>().mockResolvedValue({ ok: false });
		expect(await hasGravatar('jane@example.com', { fetchImpl })).toBe(false);
	});

	it('returns false rather than throwing when the request fails', async () => {
		const fetchImpl = vi.fn<GravatarFetch>().mockRejectedValue(new Error('offline'));
		expect(await hasGravatar('jane@example.com', { fetchImpl })).toBe(false);
	});
});
