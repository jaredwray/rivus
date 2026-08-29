import type { APIRoute } from 'astro';
import { serializeSitemap, sitemap } from '../lib/sitemap';

export const GET: APIRoute = () => {
	return new Response(serializeSitemap(sitemap()), {
		headers: { 'content-type': 'application/xml; charset=utf-8' },
	});
};
