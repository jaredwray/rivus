import type { APIRoute } from 'astro';
import { manifest } from '../lib/manifest';

export const GET: APIRoute = () => {
	return new Response(JSON.stringify(manifest(), null, 2), {
		headers: { 'content-type': 'application/manifest+json; charset=utf-8' },
	});
};
