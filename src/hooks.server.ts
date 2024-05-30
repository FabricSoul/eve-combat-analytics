import mongoose from 'mongoose';
import { connectToDatabase } from '$lib/server/util/db';
import type { Handle } from '@sveltejs/kit';

await connectToDatabase();

export const handle: Handle = async ({ event, resolve }) => {
	if (mongoose.connection.readyState !== 1) {
		await connectToDatabase();
	}
	return resolve(event);
};
