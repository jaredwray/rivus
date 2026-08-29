import type { APIRoute } from 'astro';
import { robots, serializeRobots } from '../lib/robots';

export const GET: APIRoute = () => {
	return new Response(serializeRobots(robots()), {
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
};
