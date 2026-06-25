import mongoose from 'mongoose';
import type { ReadinessResult } from '../types';

/** Open the shared Mongoose connection. */
export async function connectMongoose(uri: string): Promise<typeof mongoose> {
	mongoose.set('strictQuery', true);
	await mongoose.connect(uri);
	return mongoose;
}

export async function disconnectMongoose(): Promise<void> {
	await mongoose.disconnect();
}

/** True once the Mongoose connection's socket is open (a liveness signal). */
export function isMongoConnected(): boolean {
	return mongoose.connection.readyState === 1;
}

/**
 * Verify the connection can actually *operate on* the database, not merely that
 * the socket and authentication handshake completed. `mongoose.connect()` resolves
 * as soon as the user authenticates, but a user that authenticates yet lacks roles
 * on the target database still fails *every* query with "not authorized" — which
 * otherwise surfaces only as an opaque 500 on each request.
 *
 * We probe with the very operation the API relies on — a `find` on the `users`
 * collection — so the check requires exactly the privilege the service needs and
 * reproduces the original failure (signup's `findByEmail` is a `find` on `users`).
 * A diagnostic command tests the wrong thing: `ping` skips authorization entirely,
 * while `dbStats`/`listCollections` ride separate privileges that a least-privilege
 * CRUD role might not grant. `findOne` is cheap (a single `_id`-only document) and
 * returns null on an empty or not-yet-created collection, so it never false-fails.
 *
 * Returns `{ ready, reason }` rather than throwing, so a caller can both gate
 * readiness and surface *why* it failed (a startup log, the `/ready` body) without
 * the container crash-looping out of reach.
 */
export async function checkDatabaseReady(): Promise<ReadinessResult> {
	const db = mongoose.connection.db;
	if (!isMongoConnected() || !db) {
		return { ready: false, reason: 'database connection is not open' };
	}
	try {
		await db.collection('users').findOne({}, { projection: { _id: 1 } });
		return { ready: true };
	} catch (error) {
		return { ready: false, reason: summarizeDatabaseError(error) };
	}
}

/**
 * Reduce a driver error to a short, safe one-liner for logs and the public `/ready`
 * probe: keep the diagnostic (e.g. "not authorized on rivus") but drop Mongo's
 * verbose command echo — filters, projections, per-request session UUIDs — and cap
 * the length, so the endpoint never leaks request internals or unbounded text.
 */
function summarizeDatabaseError(error: unknown): string {
	const { codeName, message } = (error ?? {}) as { codeName?: string; message?: string };
	const full = message ?? String(error);
	const summary = (full.split(' to execute command')[0] ?? full).trim().slice(0, 200);
	return codeName ? `${codeName}: ${summary}` : summary;
}
