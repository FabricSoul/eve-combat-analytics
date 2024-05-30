import mongoose, { Model, Schema } from 'mongoose';

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
	damageDealt: { type: Number, required: false },
	damageTaken: { type: Number, required: false },
	repairGiven: { type: Number, required: false },
	repairTaken: { type: Number, required: false },
	warpDisrupted: { type: Number, required: false },
	warpDisruptedBy: { type: Number, required: false },
	warpScrambled: { type: Number, required: false },
	warpScrambledBy: { type: Number, required: false },
	energyNeutralized: { type: Number, required: false },
	energyNeutralizedBy: { type: Number, required: false },
	energyNosed: { type: Number, required: false },
	energyNosedBy: { type: Number, required: false },
	energyTransferred: { type: Number, required: false },
	energyTransferredBy: { type: Number, required: false }
});

export const CharacterModel =
	(mongoose.models.Character as Model<Character>) ||
	mongoose.model<Character>('Character', characterSchema);
