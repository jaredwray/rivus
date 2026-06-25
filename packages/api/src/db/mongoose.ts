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
 * otherwise surfaces only as an opaque 500 on each request. `{ ping: 1 }` is exempt
 * from authorization and so wouldn't catch that; `listCollections` requires the
 * `listCollections` privilege (granted by the read/readWrite roles the app needs),
 * so it does — and with `nameOnly: true` it only reads the metadata catalog, so it
 * stays cheap enough to run on every readiness poll. Returns false (never throws)
 * when the connection is closed or the command fails, which is what a probe wants.
 */
export async function isDatabaseReady(): Promise<boolean> {
	const db = mongoose.connection.db;
	if (!isMongoConnected() || !db) {
		return false;
	}
	try {
		await db.command({ listCollections: 1, nameOnly: true });
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
		await db.command({ listCollections: 1, nameOnly: true });
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
