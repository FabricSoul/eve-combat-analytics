import type { PageServerLoad } from './$types';
import { BattleModel } from '$lib/models/battle';

export const load = (async ({ url }) => {
	// get the id from the URL
	const battleId = url.pathname.split('/')[2];

	console.log('battleId:', battleId);

	// Get the battle object from the database
	const battle = await BattleModel.findOne({ id: battleId })
		.populate('characters')
		.select('-_id -__v')
		.lean();

	return { battle: battle };
}) satisfies PageServerLoad;
