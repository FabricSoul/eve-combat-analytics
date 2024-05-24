import type { PageServerLoad, Actions } from './$types';
import solarSystemName from '$lib/eve/solarSystemName.json';
import { BattleModel, type IBattle } from '$lib/models/battle';
import type { Character } from '$lib/models/character';
import { error, redirect } from '@sveltejs/kit';
import { generateRandomId } from '$lib/util/battleHelper';

export const load = (async () => {
	try {
		const battles: IBattle[] = await BattleModel.find()
			.sort({ dateStart: -1 }) // Sort by dateStart in descending order
			.limit(5) // Limit to 5 documents
			.populate('characters')
			.select('-_id -__v') // Exclude _id and __v fields
			.lean();

		return { battles: battles };
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
			throw error(400, 'Please provide all required fields');
		}

		// Create a string for id
		const id = generateRandomId();

		try {
			const battle = new BattleModel({
				id,
				system,
				dateStart,
				dateEnd,
				characters
			});

			await battle.save();
		} catch (err) {
			console.error('Error creating battle:', err);
			error(500, 'An error occurred while creating the battle.');
		}

		console.debug('calling redirect');
		redirect(303, `/battles/${id}`);
	}
};
