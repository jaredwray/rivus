import mongoose from 'mongoose';

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
 * We probe with the very operation the API relies on — a `find` on an app
 * collection — so the check requires exactly the privilege the service needs and
 * reproduces the original failure (signup's `findByEmail` is a `find` on `users`).
 * A diagnostic command tests the wrong thing: `ping` skips authorization entirely,
 * while `dbStats`/`listCollections` ride separate privileges that a least-privilege
 * CRUD role might not grant. `findOne` is cheap (a single `_id`-only document) and
 * returns null on an empty or not-yet-created collection, so it never false-fails.
 * Returns false (never throws) when the connection is closed or the query fails,
 * which is what a probe wants.
 */
export async function isDatabaseReady(): Promise<boolean> {
	const db = mongoose.connection.db;
	if (!isMongoConnected() || !db) {
		return false;
	}
	try {
		await db.collection('users').findOne({}, { projection: { _id: 1 } });
		return true;
	} catch {
		return false;
	}
}

/**
 * Like {@link isDatabaseReady}, but throws a clear, actionable error instead of
 * returning false — so a roles/connection-string misconfiguration fails loudly at
 * startup (with a log that says how to fix it) rather than letting the API boot
 * "healthy" and then return 500 for every authenticated request.
 */
export async function assertDatabaseReady(): Promise<void> {
	const db = mongoose.connection.db;
	if (!isMongoConnected() || !db) {
		throw new Error('MongoDB connection is not open');
	}
	try {
		await db.collection('users').findOne({}, { projection: { _id: 1 } });
	} catch (error) {
		const name = mongoose.connection.name ?? '(default)';
		throw new Error(
			`Connected to MongoDB but cannot query database "${name}". The database user ` +
				'authenticated successfully but is not authorized to read/write it, so every request ' +
				`would fail with an opaque 500. Grant the user readWrite on "${name}" (in Atlas: ` +
				'Database Access → Edit the user), and confirm MONGODB_URI uses the correct database ' +
				`name and authSource. Underlying error: ${(error as Error).message}`,
			{ cause: error },
		);
	}
}
