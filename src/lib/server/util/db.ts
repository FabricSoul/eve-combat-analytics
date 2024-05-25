import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGO_URI || '';
const dbName = process.env.MONGO_DB || '';
const username = process.env.MONGO_USER || '';
const password = process.env.MONGO_PASS || '';

if (!uri || !dbName || !username || !password) {
	throw new Error('Please define all the required environment variables');
}

const targetUri = `mongodb://${username}:${password}@${uri}/${dbName}`;
console.log('Connecting to database:', targetUri);

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

export default mongoose;
