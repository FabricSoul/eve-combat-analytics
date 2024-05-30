import mongoose, { Model, Schema } from 'mongoose';
import { type Character, characterSchema } from '$lib/server/models/character';
import { type CharacterBattleData, characterBattleDataSchema } from '$lib/server/models/datasets';

export interface IBattle {
	id: string;
	system: string;
	dateStart: Date;
	dateEnd: Date;
	characters: Character[];
	characterBattleData: CharacterBattleData[];
}

const battleSchema = new Schema<IBattle>({
	id: { type: String, required: true },
	system: { type: String, required: true },
	dateStart: { type: Date, required: true },
	dateEnd: { type: Date, required: true },
	characters: [characterSchema],
	characterBattleData: [characterBattleDataSchema]
});

export const BattleModel =
	(mongoose.models.Battle as Model<IBattle>) || mongoose.model<IBattle>('Battle', battleSchema);
