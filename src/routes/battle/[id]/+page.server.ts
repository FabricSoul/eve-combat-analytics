import type { PageServerLoad } from './$types';
import { BattleModel } from '$lib/server/models/battle';
import { error } from '@sveltejs/kit';

export const load = (async ({ url }) => {
	// get the id from the URL
	const battleId = url.pathname.split('/')[2];

	console.log('battleId:', battleId);

	// Get the battle object from the database
	const battle = await BattleModel.findOne({ id: battleId })
		.populate('characters')
		.select('-_id -__v')
		.lean();

	if (!battle) {
		error(404, 'Battle not found');
	}

	return { battle };
}) satisfies PageServerLoad;

export const actions = {
	upload: async ({ request }) => {
		const formData = await request.formData();
		const file = formData.get('file');

		// TODO: Parse and get the character data from the file
		// TODO: Parse the file and construct dataset for this character

		// TODO: Get the battle from battleId

		// TODO: Update the battle with the new characters

		// TODO: Write this charater's data to battle dataset

		// TODO: Retrieve and construct the new dataset for the battle

		// Return the updated battle
	}
};
