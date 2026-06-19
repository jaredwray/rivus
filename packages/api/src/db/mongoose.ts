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

/** True once the Mongoose connection is open and usable. */
export function isMongoConnected(): boolean {
	return mongoose.connection.readyState === 1;
}
