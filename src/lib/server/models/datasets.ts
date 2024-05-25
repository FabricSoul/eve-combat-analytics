import { Schema } from 'mongoose';

interface DamageDeltDataset {
	characterName: string;
	damageDelt: {
		weapon: string;
		damage: number;
		hitType: string;
	};
	timestamp: Date;
}

interface RepairDataset {
	characterName: string;
	repair: number;
	timestamp: Date;
}
interface DamageTakenDataset {
	characterName: string;
	damageTaken: number;
	timestamp: Date;
}

interface EnergyNutralizedDataset {
	characterName: string;
	energyNutralized: number;
	timestamp: Date;
}

export interface Dataset {
	damageDelt: DamageDeltDataset[];
	repair: RepairDataset[];
	damageTaken: DamageTakenDataset[];
	energyNutralized: EnergyNutralizedDataset[];
}

export const datasetSchema = new Schema<Dataset>({
	damageDelt: [
		{
			characterName: String,
			damageDelt: {
				weapon: String,
				damage: Number,
				hitType: String
			},
			timestamp: Date
		}
	],
	repair: [
		{
			characterName: String,
			repair: Number,
			timestamp: Date
		}
	],
	damageTaken: [
		{
			characterName: String,
			damageTaken: Number,
			timestamp: Date
		}
	],
	energyNutralized: [
		{
			characterName: String,
			energyNutralized: Number,
			timestamp: Date
		}
	]
});
