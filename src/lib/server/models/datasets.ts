import { Schema } from 'mongoose';

export interface DamageToByTime {
	timestamp: Date;
	damageNumber?: number;
	weapon?: string;
	hitEfficiency?: string;
	gameId: string;
	combatMessage: string;
}
export interface DamageFromByTime {
	timestamp: Date;
	damageNumber?: number;
	weapon?: string;
	hitEfficiency?: string;
	gameId: string;
	combatMessage: string;
}

export interface RepairFromByTime {
	timestamp: Date;
	repNumber?: number;
	module?: string;
	repType?: string;
	gameId: string;
	combatMessage: string;
}

export interface RepairToByTime {
	timestamp: Date;
	repNumber?: number;
	module?: string;
	repType?: string;
	gameId: string;
	combatMessage: string;
}

export interface PointByTime {
	timestamp: Date;
	pointType?: string;
	pointFrom?: string;
	pointTo?: string;
	combatMessage: string;
}

export interface EnergyNutralizedByTime {
	timestamp: Date;
	gjNumber?: number;
	gameId?: string;
	module?: string;
	combatMessage: string;
}

export interface EnergyDrainedFromByTime {
	timestamp: Date;
	gjNumber?: number;
	gameId: string;
	module?: string;
	combatMessage: string;
}

export interface EnergyDrainedToByTime {
	timestamp: Date;
	gjNumber?: number;
	gameId: string;
	module?: string;
	combatMessage: string;
}

export interface CharacterBattleData {
	characterName: string;
	DamageToByTime: DamageToByTime[];
	DamageFromByTime: DamageFromByTime[];
	RepairFromByTime: RepairFromByTime[];
	RepairToByTime: RepairToByTime[];
	PointByTime: PointByTime[];
	EnergyNutralizedByTime: EnergyNutralizedByTime[];
	EnergyDrainedFromByTime: EnergyDrainedFromByTime[];
	EnergyDrainedToByTime: EnergyDrainedToByTime[];
	totalDamageDelt: number;
	totalDamageTaken: number;
	totalRepairGiven: number;
	totalRepairTaken: number;
	totalEnergyNutralized: number;
	totalEnergyDrainedFrom: number;
	totalEnergyDrainedTo: number;
}

export const characterBattleDataSchema = new Schema<CharacterBattleData>({
	characterName: { type: String, required: true },
	DamageToByTime: [
		{
			timestamp: { type: Date, required: false },
			damageNumber: { type: Number, required: false },
			weapon: { type: String, required: false },
			hitEfficiency: { type: String, required: false },
			gameId: { type: String, required: false },
			combatMessage: { type: String, required: false }
		}
	],
	DamageFromByTime: [
		{
			timestamp: { type: Date, required: false },
			damageNumber: { type: Number, required: false },
			weapon: { type: String, required: false },
			hitEfficiency: { type: String, required: false },
			gameId: { type: String, required: false },
			combatMessage: { type: String, required: false }
		}
	],
	RepairFromByTime: [
		{
			timestamp: { type: Date, required: false },
			repNumber: { type: Number, required: false },
			module: { type: String, required: false },
			repType: { type: String, required: false },
			gameId: { type: String, required: false },
			combatMessage: { type: String, required: false }
		}
	],
	RepairToByTime: [
		{
			timestamp: { type: Date, required: false },
			repNumber: { type: Number, required: false },
			module: { type: String, required: false },
			repType: { type: String, required: false },
			gameId: { type: String, required: false },
			combatMessage: { type: String, required: false }
		}
	],
	PointByTime: [
		{
			timestamp: { type: Date, required: false },
			pointType: { type: String, required: false },
			pointFrom: { type: String, required: false },
			pointTo: { type: String, required: false },
			combatMessage: { type: String, required: false }
		}
	],
	EnergyNutralizedByTime: [
		{
			timestamp: { type: Date, required: false },
			gjNumber: { type: Number, required: false },
			gameId: { type: String, required: false },
			module: { type: String, required: false },
			combatMessage: { type: String, required: false }
		}
	],
	EnergyDrainedFromByTime: [
		{
			timestamp: { type: Date, required: false },
			gjNumber: { type: Number, required: false },
			gameId: { type: String, required: false },
			module: { type: String, required: false },
			combatMessage: { type: String, required: false }
		}
	],
	EnergyDrainedToByTime: [
		{
			timestamp: { type: Date, required: false },
			gjNumber: { type: Number, required: false },
			gameId: { type: String, required: false },
			module: { type: String, required: false },
			combatMessage: { type: String, required: false }
		}
	],
	totalDamageDelt: { type: Number, default: 0 },
	totalDamageTaken: { type: Number, default: 0 },
	totalRepairGiven: { type: Number, default: 0 },
	totalRepairTaken: { type: Number, default: 0 },
	totalEnergyNutralized: { type: Number, default: 0 },
	totalEnergyDrainedFrom: { type: Number, default: 0 },
	totalEnergyDrainedTo: { type: Number, default: 0 }
});
