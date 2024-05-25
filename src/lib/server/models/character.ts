import mongoose from '$lib/server/util/db';
import { Model, Schema } from 'mongoose';

// 火力，摇修，点，毁电，传电

export interface Character {
	id: number;
	name: string;
	damageDealt: number;
	damageTaken: number;
	repairGiven: number;
	repairTaken: number;
	warpDisrupted: number;
	warpDisruptedBy: number;
	warpScrambled: number;
	warpScrambledBy: number;
	energyNeutralized: number;
	energyNeutralizedBy: number;
	energyNosed: number;
	energyNosedBy: number;
	energyTransferred: number;
	energyTransferredBy: number;
}

export const characterSchema = new Schema<Character>({
	id: { type: Number, required: true },
	name: { type: String, required: true },
	damageDealt: { type: Number, required: true },
	damageTaken: { type: Number, required: true },
	repairGiven: { type: Number, required: true },
	repairTaken: { type: Number, required: true },
	warpDisrupted: { type: Number, required: true },
	warpDisruptedBy: { type: Number, required: true },
	warpScrambled: { type: Number, required: true },
	warpScrambledBy: { type: Number, required: true },
	energyNeutralized: { type: Number, required: true },
	energyNeutralizedBy: { type: Number, required: true },
	energyNosed: { type: Number, required: true },
	energyNosedBy: { type: Number, required: true },
	energyTransferred: { type: Number, required: true },
	energyTransferredBy: { type: Number, required: true }
});

export const CharacterModel =
	(mongoose.models.Character as Model<Character>) ||
	mongoose.model<Character>('Character', characterSchema);
