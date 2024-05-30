import type { PageServerLoad } from './$types';
import { BattleModel } from '$lib/server/models/battle';
import { error } from '@sveltejs/kit';
import { characterParser, combatLogParser, textReader } from '$lib/server/util/dataParser';

export const load = (async ({ url }) => {
	// get the id from the URL
	const battleId = url.pathname.split('/')[2];

	// Get the battle object from the database
	const battle = await BattleModel.findOne({ id: battleId })
		.populate({
			path: 'characters',
			select: '-__v'
		})
		.select('-_id -__v')
		.lean({
			flattenMaps: true
		});
	if (battle) {
		if (Array.isArray(battle.characters)) {
			battle.characters = battle.characters.map((character) => {
				const { _id, ...rest } = character;
				return rest;
			});
		}

		if (Array.isArray(battle.characterBattleData)) {
			battle.characterBattleData = battle.characterBattleData.map((characterBattleData) => {
				const { _id, ...rest } = characterBattleData;

				// Remove the _id property from each object in the arrays
				Object.keys(rest).forEach((key) => {
					if (Array.isArray(rest[key])) {
						rest[key] = rest[key].map((obj) => {
							const { _id, ...objRest } = obj;
							return objRest;
						});
					}
				});

				return rest;
			});
		}
	}
	if (!battle) {
		error(404, 'Battle not found');
	}

	return { battle };
}) satisfies PageServerLoad;

export const actions = {
	upload: async ({ request }) => {
		const formData = await request.formData();
		const file = formData.get('file') as File;
		const battleId = formData.get('battleId') as string;
		const fileContent = textReader(file);
		// Parse and get the character data from the file
		// Update the battle with the new characters
		const { valid, errorMsg } = await characterParser(await fileContent, battleId);

		if (!valid) {
			error(400, `${errorMsg}`);
		}

		// Write this charater's data to battle dataset
		const { validCombat, errorMsgCombat } = await combatLogParser(await fileContent, battleId);
		if (!validCombat) {
			console.log('Calling error');
			error(400, `${errorMsgCombat}`);
		}

		return { success: true };
	}
};
