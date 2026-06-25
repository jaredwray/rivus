#!/usr/bin/env node
/**
 * One-off data migration: rename the `team_member` role to `member`.
 *
 * The role literal changed from `team_member` to `member` across the codebase.
 * The Mongoose enums now only accept `owner | manager | member`, so any existing
 * `memberships` / `invites` documents still holding `team_member` must be
 * rewritten or they will fail validation on the next write.
 *
 * Idempotent: re-running it simply matches zero documents the second time.
 *
 * Usage:
 *   MONGODB_URI="mongodb://…" node scripts/migrate-roles.mjs
 *   # or: pnpm --filter @rivus/api migrate:roles
 */
import mongoose from 'mongoose';

const uri =
	process.env.MONGODB_URI ?? 'mongodb://localhost:27017/rivus?replicaSet=rs0&directConnection=true';

async function main() {
	await mongoose.connect(uri);
	const db = mongoose.connection.db;
	if (!db) {
		throw new Error('No database handle after connecting');
	}

	const collections = ['memberships', 'invites'];
	for (const name of collections) {
		const result = await db
			.collection(name)
			.updateMany({ role: 'team_member' }, { $set: { role: 'member' } });
		process.stdout.write(
			`${name}: matched ${result.matchedCount}, modified ${result.modifiedCount}\n`,
		);
	}

	await mongoose.disconnect();
	process.stdout.write('Role migration complete.\n');
}

main().catch(async (error) => {
	console.error(error);
	await mongoose.disconnect().catch(() => {});
	process.exit(1);
});
