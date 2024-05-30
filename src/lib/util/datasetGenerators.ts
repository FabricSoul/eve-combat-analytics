/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LineChartDataset, PieChartDataset, PieChartData } from '$lib/models/chartDataset';
import type { IBattle } from '$lib/server/models/battle';
import type { CharacterBattleData } from '$lib/server/models/datasets';

export function generateLineChartDatasets(
	battle: IBattle,
	dataKey: keyof CharacterBattleData
): LineChartDataset[] {
	const characterCount = battle.characterBattleData.length;
	const hueStep = 360 / characterCount;

	return battle.characterBattleData.map((characterBattleData, index) => {
		const data = characterBattleData[dataKey];
		let mappedData = [];

		if (Array.isArray(data)) {
			mappedData = data.map((entry: any) => ({
				y: entry.damageNumber || entry.repNumber || entry.gjNumber,
				x: entry.timestamp,
				combatMessage: entry.combatMessage
			}));
		}

		const hue = index * hueStep;
		const borderColor = `hsl(${hue}, 100%, 50%)`;

		return {
			label: characterBattleData.characterName,
			data: mappedData,
			fill: false,
			borderColor: borderColor,
			backgroundColor: borderColor,
			tension: 0
		};
	});
}

export function generatePieChartDatasets(
	battle: IBattle,
	dataKey:
		| 'totalDamageDelt'
		| 'totalDamageTaken'
		| 'totalRepairGiven'
		| 'totalRepairTaken'
		| 'totalEnergyNutralized'
		| 'totalEnergyDrainedFrom'
		| 'totalEnergyDrainedTo'
): PieChartDataset {
	const labels: string[] = [];
	const data: number[] = [];
	const backgroundColor: string[] = [];

	const characterCount = battle.characterBattleData.length;
	const hueStep = 360 / characterCount;

	battle.characterBattleData.forEach((character, index) => {
		labels.push(character.characterName);
		data.push(character[dataKey]);

		const hue = index * hueStep;
		const color = `hsl(${hue}, 100%, 50%)`;
		backgroundColor.push(color);
	});

	return {
		labels,
		datasets: [
			{
				data,
				backgroundColor,
				hoverOffset: 4
			}
		]
	};
}
