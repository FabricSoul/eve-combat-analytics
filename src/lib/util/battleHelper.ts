export function generateRandomId() {
	// 6 numbers and 6 letters
	const numbers = '0123456789';
	const letters = 'abcdefghijklmnopqrstuvwxyz';
	let id = '';
	for (let i = 0; i < 6; i++) {
		id += numbers.charAt(Math.floor(Math.random() * numbers.length));
	}

	for (let i = 0; i < 6; i++) {
		id += letters.charAt(Math.floor(Math.random() * letters.length));
	}

	// shuffle the id
	id = id
		.split('')
		.sort(() => Math.random() - 0.5)
		.join('');

	return id;
}
