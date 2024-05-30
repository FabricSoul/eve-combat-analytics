export async function getCharacterId(characterName: string): Promise<number | null> {
	const requestBody = [characterName];
	try {
		const response = await fetch(
			'https://esi.evetech.net/latest/universe/ids/?datasource=tranquility&language=en',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(requestBody)
			}
		);

		if (response.ok) {
			const data = await response.json();
			if (data.characters && data.characters.length > 0) {
				return data.characters[0].id;
			} else {
				console.log('Character not found');
				return null;
			}
		} else {
			console.error('Error:', response.status);
			return null;
		}
	} catch (error) {
		console.error('Error:', error);
		return null;
	}
}
