import mongoose from '$lib/server/util/db';
import { Model, Schema } from 'mongoose';
import { type Character, characterSchema } from './character';
import { datasetSchema, type Dataset } from './datasets';

export interface IBattle {
	id: string;
	system: string;
	dateStart: Date;
	dateEnd: Date;
	characters: Character[];
	dataset: Dataset;
}

const battleSchema = new Schema<IBattle>({
	id: { type: String, required: true },
	system: { type: String, required: true },
	dateStart: { type: Date, required: true },
	dateEnd: { type: Date, required: true },
	characters: [characterSchema],
	dataset: datasetSchema
});

export const BattleModel =
	(mongoose.models.Battle as Model<IBattle>) || mongoose.model<IBattle>('Battle', battleSchema);
