import { z } from 'zod';

const DEV_JWT_SECRET = 'dev-secret-change-me';

const envSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		API_HOST: z.string().default('0.0.0.0'),
		API_PORT: z.coerce.number().int().positive().max(65535).default(4000),
		MONGODB_URI: z
			.string()
			.default('mongodb://localhost:27017/rivus?replicaSet=rs0&directConnection=true'),
		JWT_SECRET: z.string().min(8).default(DEV_JWT_SECRET),
		JWT_EXPIRES_IN: z.string().default('7d'),
		LOG_LEVEL: z
			.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
			.default('info'),
		CORS_ORIGIN: z.string().default('*'),
	})
	.superRefine((env, ctx) => {
		// In production, refuse to boot with the well-known dev secret or a weak one.
		if (env.NODE_ENV !== 'production') {
			return;
		}
		if (env.JWT_SECRET === DEV_JWT_SECRET) {
			ctx.addIssue({
				code: 'custom',
				path: ['JWT_SECRET'],
				message: 'JWT_SECRET must be set to a strong, non-default value in production',
			});
		} else if (env.JWT_SECRET.length < 32) {
			ctx.addIssue({
				code: 'custom',
				path: ['JWT_SECRET'],
				message: 'JWT_SECRET must be at least 32 characters in production',
			});
		}
	});

export type Config = z.infer<typeof envSchema>;

/** Parse and validate process environment into a typed config object. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	return envSchema.parse(env);
}
