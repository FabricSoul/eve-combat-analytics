import { connectToDatabase } from '$lib/server/db';
import type { Handle } from '@sveltejs/kit';

let dbConnected = false;

export const handle: Handle = async ({ event, resolve }) => {
	if (!dbConnected) {
		await connectToDatabase();
		dbConnected = true;
	}
	return resolve(event);
};
