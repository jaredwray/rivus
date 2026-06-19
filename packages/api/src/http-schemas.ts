import { itemStatusSchema } from '@rivus/core';
import { z } from 'zod';

/** Public user projection — never includes the password hash. */
export const userResponseSchema = z
	.object({
		id: z.string(),
		email: z.string(),
		name: z.string(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.meta({ id: 'User' });

export const authResponseSchema = z
	.object({
		token: z.string(),
		user: userResponseSchema,
	})
	.meta({ id: 'AuthResponse' });

export const itemResponseSchema = z
	.object({
		id: z.string(),
		ownerId: z.string(),
		name: z.string(),
		description: z.string(),
		status: itemStatusSchema,
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.meta({ id: 'Item' });

export const paginationMetaSchema = z.object({
	page: z.number().int(),
	pageSize: z.number().int(),
	total: z.number().int(),
	totalPages: z.number().int(),
	hasNextPage: z.boolean(),
	hasPreviousPage: z.boolean(),
});

export const itemListResponseSchema = z
	.object({
		data: z.array(itemResponseSchema),
		meta: paginationMetaSchema,
	})
	.meta({ id: 'ItemList' });

export const errorResponseSchema = z
	.object({
		error: z.string(),
		message: z.string(),
		statusCode: z.number().int(),
		details: z.unknown().optional(),
	})
	.meta({ id: 'Error' });

export const idParamsSchema = z.object({
	id: z.string().min(1),
});

export const healthResponseSchema = z.object({
	status: z.literal('ok'),
	uptime: z.number(),
	timestamp: z.string(),
});

export const readyResponseSchema = z.object({
	status: z.literal('ready'),
});
