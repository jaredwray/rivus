import { slugify } from '@rivus/core';

export interface Feature {
	title: string;
	description: string;
}

export const siteConfig = {
	name: 'Rivus',
	tagline: 'Ship your product across web, mobile, and the edge.',
	description:
		'Rivus is a batteries-included platform: a Fastify API, a Next.js site, a Cloudflare worker, and an Expo app — all in one typed monorepo.',
};

export const features: Feature[] = [
	{
		title: 'Typed API',
		description:
			'A Fastify REST API on MongoDB Atlas with JWT auth and a generated OpenAPI reference.',
	},
	{
		title: 'Edge Worker',
		description: 'Run scheduled and on-demand background tasks on Cloudflare Workers.',
	},
	{
		title: 'One App, Every Platform',
		description: 'A single Expo codebase ships to iOS, Android, and the web.',
	},
	{
		title: 'Shared Core',
		description: 'Domain types, Zod schemas, and utilities shared across every package.',
	},
];

/** A URL-safe anchor id for a feature, derived with the shared slugify helper. */
export function featureAnchor(feature: Feature): string {
	return slugify(feature.title);
}

export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
