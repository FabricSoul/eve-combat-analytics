import mongoose from 'mongoose';
import {  MONGO_URI} from '$env/static/private';
import { CharacterModel } from '../models/character';

if (!MONGO_URI) {
	throw new Error('Please define all the required environment variables');
}

const targetUri = MONGO_URI;

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
