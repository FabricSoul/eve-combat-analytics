import type { PageServerLoad, Actions } from './$types';
import solarSystemName from '$lib/server/eve/solarSystemName.json';
import { BattleModel, type IBattle } from '$lib/server/models/battle';
import type { Character } from '$lib/server/models/character';
import { error, redirect } from '@sveltejs/kit';
import { generateRandomId } from '$lib/server/util/battleHelper';

export const load = (async () => {
	try {
		const battles: IBattle[] = await BattleModel.find()
			.sort({ dateStart: -1 }) // Sort by dateStart in descending order
			.limit(5) // Limit to 5 documents
			.populate({
				path: 'characters',
				select: '-__v'
			})
			.select('-_id -__v') // Exclude _id and __v fields
			.lean({
				flattenMaps: true
			});

		// console.log(
		// 	'Battles characters:',
		// 	battles.map((battle) => battle.characters)
		// );

		// Iterate through each battle and transform the characters array
		const transformedBattles = battles.map((battle) => {
			if (Array.isArray(battle.characters)) {
				// Not passing _id field from the characters array
				battle.characters = battle.characters.map((character) => {
					const { _id, ...rest } = character;
					return rest;
				});
			}

			if (Array.isArray(battle.characterBattleData)) {
				// Not passing _id field from the characterBattleData array
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

			return battle;
		});

		return { battles: transformedBattles };
	} catch (err) {
		console.error('Error fetching battles:', err);
		return { battles: [] };
	}
}) satisfies PageServerLoad;

export const actions: Actions = {
	search: async ({ request }) => {
		const formData = await request.formData();
		const query = formData.get('query')?.toString() || '';

		if (query.length === 0) {
			return [];
		}

		const filteredSystems = solarSystemName
			.filter((system) => system.label.toLowerCase().includes(query.toLowerCase()))
			.map((system) => system.label);

		// slice the first 10 results
		filteredSystems.length = Math.min(filteredSystems.length, 15);

		return filteredSystems;
	},
	submit: async ({ request }) => {
		const data = await request.formData();
		const system = data.get('system') as string;
		const dateStart = new Date(data.get('dateStart') as string);
		const dateEnd = new Date(data.get('dateEnd') as string);
		const characters = JSON.parse(data.get('characters') as string) as Character[];

		// Perform server-side validation
		if (!system || !dateStart || !dateEnd || !characters) {
			error(400, 'Please provide all required fields');
		}

		// Create a string for id
		const id = generateRandomId();

		const battle = new BattleModel({
			id,
			system,
			dateStart,
			dateEnd
		});

		await battle.save().then(() => {
			redirect(303, `/battle/${id}`);
		});
	}
};
