import mongoose, { connectToDatabase } from '$lib/server/util/db';
import type { Handle } from '@sveltejs/kit';

console.log('Connecting to database...');
await connectToDatabase();
console.log('Connected to database');

export const handle: Handle = async ({ event, resolve }) => {
	if (mongoose.connection.readyState !== 1) {
		await connectToDatabase();
	}
	return resolve(event);
};
