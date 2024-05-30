import mongoose from 'mongoose';
import { MONGO_DB, MONGO_URI, MONGO_PASS, MONGO_USER } from '$env/static/private';
import { CharacterModel } from '../models/character';

if (!MONGO_DB || !MONGO_URI || !MONGO_PASS || !MONGO_USER) {
	throw new Error('Please define all the required environment variables');
}

const targetUri = `mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_URI}/${MONGO_DB}`;

export async function connectToDatabase() {
	if (mongoose.connection.readyState === 1) {
		console.log('Already connected to the database');
		return;
	}

	await mongoose
		.connect(targetUri, { connectTimeoutMS: 5000 })
		.then(() => {
			console.log('Connected to the database successfully');
		})
		.catch((err) => {
			console.error('Failed to connect to the database:', err);
		});
}

export async function querryCharacter(characterName: string) {
	// Use characterName to query the database
	const character = await CharacterModel.findOne({ name: characterName })
		.select('-_id -__v')
		.lean();
	return character;
}
