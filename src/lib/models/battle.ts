import { Model, Schema } from 'mongoose';
import { connection } from '$lib/server/db';
import { type Character, characterSchema } from './character';

export interface IBattle {
	id: string;
	system: string;
	dateStart: Date;
	dateEnd: Date;
	characters: Character[];
}

const battleSchema = new Schema<IBattle>({
	id: { type: String, required: true },
	system: { type: String, required: true },
	dateStart: { type: Date, required: true },
	dateEnd: { type: Date, required: true },
	characters: [characterSchema]
});

export const BattleModel =
	(connection.models.Battle as Model<IBattle>) || connection.model<IBattle>('Battle', battleSchema);
