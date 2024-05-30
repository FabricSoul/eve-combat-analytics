/* eslint-disable no-useless-escape */
import { querryCharacter } from '$lib/server/util/db';
import { getCharacterId } from '$lib/server/util/eveApi';
import { CharacterModel } from '$lib/server/models/character';
import { BattleModel } from '$lib/server/models/battle';
import type {
	DamageToByTime,
	DamageFromByTime,
	RepairFromByTime,
	RepairToByTime,
	PointByTime,
	EnergyNutralizedByTime,
	EnergyDrainedFromByTime,
	EnergyDrainedToByTime,
	CharacterBattleData
} from '$lib/server/models/datasets';

export async function textReader(file: File): Promise<string> {
	try {
		const fileContent = await file.text();
		return fileContent;
	} catch (error) {
		console.error('Error:', error);
		return '';
	}
}

/**
 * Parses the character data from the given text and performs necessary actions based on the data.
 * @param text - The text containing the character data.
 * @returns A Promise that resolves to void.
 */
export async function characterParser(
	text: string,
	battleId: string
): Promise<{ valid: boolean; errorMsg: string }> {
	const lines = text.split('\n');
	if (lines.length >= 3) {
		const listenerLine = lines[2].trim();
		const listenerNameMatch = listenerLine.match(/(?:Listener|收听者): (.+)/);
		const characterName = listenerNameMatch ? listenerNameMatch[1] : '';

		// Get the first datetime from the log
		const datetimeRegex = /\[ (\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}) \]/;
		const firstDateTime = lines[5].match(datetimeRegex);
		// const lastDateTime = lines[lines.length - 2].match(datetimeRegex);

		// Check if first datetime is valid
		if (!firstDateTime) {
			console.error('Invalid datetime');
			return { valid: false, errorMsg: 'Invalid log' };
		}

		// Get the battle object from the database, check if character already exists
		const battle = await BattleModel.findOne({ id: battleId })
			.populate('characters')
			.select('-_id -__v')
			.lean();

		const characterExists = battle?.characters.find(
			(character) => character.name === characterName
		);

		if (!characterExists) {
			// check if the character already exists in the database
			const dbCharacter = await querryCharacter(characterName);
			if (!dbCharacter) {
				console.log('New character detected, adding to the database');
				const characterId = await getCharacterId(characterName);
				if (characterId) {
					const newCharacter = new CharacterModel({
						id: characterId,
						name: characterName
					});
					await newCharacter.save();
				}
			}

			const character = await CharacterModel.findOne({ name: characterName })
				.select('name id')
				.lean();
			// Add the character to the battle
			await BattleModel.updateOne({ id: battleId }, { $push: { characters: character } });
			console.log(`Character ${characterName} added to the battle`);

			return { valid: true, errorMsg: '' };
		}
	}
	return { valid: false, errorMsg: 'Invalid log' };
}

/**
 * Parses the combat log and updates the character data and battle data.
 * @param log - The combat log to parse.
 * @param battleId - The id of the battle.
 * @returns A Promise that resolves to void.
 */
export async function combatLogParser(
	log: string,
	battleId: string
): Promise<{ validCombat: boolean; errorMsgCombat: string }> {
	try {
		console.log('Parsing combat log');
		const lines = log.split('\n');

		let startDateTime;
		let endDateTime;
		// Get the battle from the database using the battleId
		const battle = await BattleModel.findOne({ id: battleId });
		if (battle) {
			startDateTime = new Date(battle.dateStart);
			endDateTime = new Date(battle.dateEnd);
		}

		if (!startDateTime || !endDateTime) {
			console.error('Invalid battle');
			return { validCombat: false, errorMsgCombat: 'Invalid battle' };
		}
		// Determine the log language
		const logLanguage = lines[1].trim().includes('游戏记录') ? 'zh' : 'en';

		// Get character name from the listener line
		const listenerLine = lines[2].trim();
		const listenerNameMatch = listenerLine.match(/(?:Listener|收听者): (.+)/);
		const characterName = listenerNameMatch ? listenerNameMatch[1] : '';
		console.log('Character name:', characterName);

		// Define regex patterns based on language
		const patterns = {
			combat:
				logLanguage === 'zh'
					? /\[([\d\.\s:]+)\]\s+\(combat\)\s+(\d+)\s+(来自|对)\s+(.+?)\s+-\s+(.+?)\s+-\s+(.+)/
					: /\[([\d\.\s:]+)\]\s+\(combat\)\s+(\d+)\s+(from|to)\s+(.+?)\s+-\s+(.+?)\s+-\s+(.+)/,
			repair:
				logLanguage === 'zh'
					? /\[([\d\.\s:]+)\]\s+\(combat\)\s+(\d+)\s*(远程装甲维修量|远程护盾回充增量)\s*(至|由)\s*(.+?)\s+-\s+(.+)/
					: /\[([\d\.\s:]+)\]\s+\(combat\)\s+(\d+)\s+(remote armor repaired|remote shield boosted)\s+(to|by)\s+(.+?)\s+-\s+(.+)/,
			youMiss:
				logLanguage === 'zh'
					? /\[([\d\.\s:]+)\] \(combat\) 你的一组(.+?)\*完全没有打中(.+?) - \2/
					: /\[([\d\.\s:]+)\] \(combat\) Your group of (.+?) misses (.+?) completely - \2/,
			missYou:
				logLanguage === 'zh'
					? /\[([\d\.\s:]+)\] \(combat\) (.+?)完全没有打中你 - (.+)/
					: /\[([\d\.\s:]+)\] \(combat\) (.+?) misses you completely - (.+)/,
			point:
				logLanguage === 'zh'
					? /\[([\d\.\s:]+)\] \(combat\) (.+?)\s*试图跃迁(扰频|扰断)\s(.+)/
					: /\[([\d\.\s:]+)\] \(combat\) Warp (disruption|scramble) attempt from (.+?)\s?-\s?to (.+)!/,
			energyNeutralized:
				logLanguage === 'zh'
					? /\[([\d\.\s:]+)\]\s+\(combat\)\s+(\d+)\s+GJ能量中和(.+?)\s+-\s+(.+)/
					: /\[([\d\.\s:]+)\]\s+\(combat\)\s+(\d+)\s+GJ energy neutralized (.+?)\s+-\s+-\s+(.+)/,
			energyDrained:
				logLanguage === 'zh'
					? /\[([\d\.\s:]+)\]\s+\(combat\)\s+([-+]?\d+)\s+GJ被(从|吸取到)(.+?)\s+-\s+(.+)/
					: /\[([\d\.\s:]+)\]\s+\(combat\)\s+([-+]?\d+)\s+GJ energy drained (to|from) (.+?)\s+-\s+-\s+(.+)/
		};

		const results = [];

		for (let i = 0; i < lines.length - 1; i++) {
			let line = lines[i];
			while (i < lines.length - 1 && !lines[i + 1].startsWith('[')) {
				line = line.trim() + lines[i + 1];
				i++;
			}
			if (line.includes('197-variant')) {
				continue;
			}

			// Remove HTML tags
			const cleanLine = line.trim().replace(/<[^<]+?>/g, '');

			const combatMessage = cleanLine.replace(/\[([\d\.\s:]+)\]\s+\(combat\)\s+/, '');

			// Match the cleaned line against the patterns
			const matchDamage = cleanLine.match(patterns.combat);
			const matchRepair = cleanLine.match(patterns.repair);
			const matchYouMiss = cleanLine.match(patterns.youMiss);
			const matchMissYou = cleanLine.match(patterns.missYou);
			const matchPoint = cleanLine.match(patterns.point);
			const matchEnergyNeutralized = cleanLine.match(patterns.energyNeutralized);
			const matchEnergyDrained = cleanLine.match(patterns.energyDrained);

			if (matchDamage) {
				const [, timestamp, dmgNumber, direction, gameId, weapon, hitEfficiency] = matchDamage;

				// Translate hit_efficiency if logLanguage is 'zh'
				let translatedHitEfficiency = hitEfficiency.trim();
				let translatedDirection = direction;
				if (logLanguage === 'zh') {
					switch (hitEfficiency.trim()) {
						case '轻轻擦过':
							translatedHitEfficiency = 'Grazes';
							break;
						case '擦过':
							translatedHitEfficiency = 'Glances Off';
							break;
						case '命中':
							translatedHitEfficiency = 'Hits';
							break;
						case '穿透':
							translatedHitEfficiency = 'Penetrates';
							break;
						case '强力一击':
							translatedHitEfficiency = 'Smashes';
							break;
						case '致命一击':
							translatedHitEfficiency = 'Wrecks';
							break;
						default:
							translatedHitEfficiency = hitEfficiency.trim();
					}
					switch (direction) {
						case '来自':
							translatedDirection = 'from';
							break;
						case '对':
							translatedDirection = 'to';
							break;
						default:
							translatedDirection = direction;
					}
				}

				if (new Date(timestamp) >= startDateTime && new Date(timestamp) <= endDateTime) {
					results.push({
						type: 'damage',
						direction: translatedDirection,
						timestamp: new Date(timestamp),
						damageNumber: parseInt(dmgNumber),
						weapon: weapon.trim(),
						hitEfficiency: translatedHitEfficiency,
						gameId: gameId.trim(),
						combatMessage: combatMessage
					});
				}
			} else if (matchRepair) {
				const [, timestamp, repNumber, repType, direction, gameId, module] = matchRepair;

				let translatedDirection = direction;
				let translatedRepType = repType;
				if (logLanguage === 'zh') {
					switch (direction) {
						case '至':
							translatedDirection = 'to';
							break;
						case '由':
							translatedDirection = 'by';
							break;
						default:
							translatedDirection = direction;
					}
					switch (repType) {
						case '远程装甲维修量':
							translatedRepType = 'remote armor repaired';
							break;
						case '远程护盾回充增量':
							translatedRepType = 'remote shield boosted';
							break;
						default:
							translatedRepType = repType;
					}
				}
				if (new Date(timestamp) >= startDateTime && new Date(timestamp) <= endDateTime) {
					results.push({
						type: 'repair',
						direction: translatedDirection,
						timestamp: new Date(timestamp),
						repNumber: parseInt(repNumber),
						module: module.trim(),
						repType: translatedRepType,
						gameId: gameId.trim(),
						combatMessage: combatMessage
					});
				}
			} else if (matchYouMiss) {
				const [, timestamp, weaponType, gameId] = matchYouMiss;
				if (new Date(timestamp) >= startDateTime && new Date(timestamp) <= endDateTime) {
					results.push({
						type: 'damage',
						direction: 'to',
						timestamp: new Date(timestamp),
						damageNumber: 0,
						weapon: weaponType,
						hitEfficiency: 'Misses',
						gameId: gameId,
						combatMessage: combatMessage
					});
				}
			} else if (matchMissYou) {
				const [, timestamp, gameId, weaponType] = matchMissYou;
				if (new Date(timestamp) >= startDateTime && new Date(timestamp) <= endDateTime) {
					results.push({
						type: 'damage',
						direction: 'from',
						timestamp: new Date(timestamp),
						damageNumber: 0,
						weapon: weaponType,
						hitEfficiency: 'Misses',
						gameId: gameId,
						combatMessage: combatMessage
					});
				}
			} else if (matchPoint) {
				const [, timestamp, pointType, pointFrom, pointTo] = matchPoint;
				// const cleanPointTo = pointTo.replace(/[!！]$/, '');

				let translatedPointType = pointType;
				if (logLanguage === 'zh') {
					switch (pointType) {
						case '扰频':
							translatedPointType = 'disruption';
							break;
						case '扰断':
							translatedPointType = 'scramble';
							break;
						default:
							translatedPointType = pointType;
					}
				}

				if (pointFrom === 'you' || pointTo === 'you' || pointFrom === '你' || pointTo === '你') {
					if (pointFrom === 'you' || pointFrom === '你') {
						if (new Date(timestamp) >= startDateTime && new Date(timestamp) <= endDateTime) {
							results.push({
								type: 'point',
								timestamp: new Date(timestamp),
								pointType: translatedPointType,
								pointFrom: characterName,
								pointTo: pointTo,
								combatMessage: `Warp ${translatedPointType} from ${characterName} to ${pointTo}`
							});
						}
					} else {
						if (new Date(timestamp) >= startDateTime && new Date(timestamp) <= endDateTime) {
							results.push({
								type: 'point',
								timestamp: new Date(timestamp),
								pointType: translatedPointType,
								pointFrom: pointFrom,
								pointTo: characterName,
								combatMessage: `Warp ${translatedPointType} from ${pointFrom} to ${characterName}`
							});
						}
					}
				}
			} else if (matchEnergyNeutralized) {
				const [, timestamp, gjNumber, gameId, module] = matchEnergyNeutralized;
				if (new Date(timestamp) >= startDateTime && new Date(timestamp) <= endDateTime) {
					results.push({
						type: 'energyNeutralized',
						timestamp: new Date(timestamp),
						gjNumber: parseInt(gjNumber),
						gameId: gameId.trim(),
						module: module.trim(),
						combatMessage: combatMessage
					});
				}
			} else if (matchEnergyDrained) {
				const [, timestamp, gjNumber, direction, gameId, module] = matchEnergyDrained;
				if (new Date(timestamp) >= startDateTime && new Date(timestamp) <= endDateTime) {
					results.push({
						type: 'energyDrained',
						timestamp: new Date(timestamp),
						direction: direction === '从' || direction === 'from' ? 'from' : 'to',
						gjNumber: parseInt(gjNumber),
						gameId: gameId.trim(),
						module: module.trim(),
						combatMessage: combatMessage
					});
				}
			}
		}
		// Construct new characterBattleData object
		const characterBattleData: CharacterBattleData = {
			characterName: characterName,
			DamageToByTime: [],
			DamageFromByTime: [],
			RepairFromByTime: [],
			RepairToByTime: [],
			PointByTime: [],
			EnergyNutralizedByTime: [],
			EnergyDrainedFromByTime: [],
			EnergyDrainedToByTime: [],
			totalDamageDelt: 0,
			totalDamageTaken: 0,
			totalRepairGiven: 0,
			totalRepairTaken: 0,
			totalEnergyNutralized: 0,
			totalEnergyDrainedFrom: 0,
			totalEnergyDrainedTo: 0
		};

		// Update the characterBattleData object with the results
		results.forEach((result) => {
			if (result.type === 'damage') {
				if (result.direction === 'to') {
					const damageToByTime: DamageToByTime = {
						timestamp: result.timestamp,
						damageNumber: result.damageNumber,
						weapon: result.weapon,
						hitEfficiency: result.hitEfficiency,
						gameId: result.gameId,
						combatMessage: result.combatMessage
					};
					characterBattleData.DamageToByTime.push(damageToByTime);
					characterBattleData.totalDamageDelt += result.damageNumber || 0;
				} else if (result.direction === 'from') {
					const damageFromByTime: DamageFromByTime = {
						timestamp: result.timestamp,
						damageNumber: result.damageNumber,
						weapon: result.weapon,
						hitEfficiency: result.hitEfficiency,
						gameId: result.gameId,
						combatMessage: result.combatMessage
					};
					characterBattleData.DamageFromByTime.push(damageFromByTime);
					characterBattleData.totalDamageTaken += result.damageNumber || 0;
				}
			} else if (result.type === 'repair') {
				if (result.direction === 'to') {
					const repairToByTime: RepairToByTime = {
						timestamp: result.timestamp,
						repNumber: result.repNumber,
						module: result.module,
						repType: result.repType,
						gameId: result.gameId,
						combatMessage: result.combatMessage
					};
					characterBattleData.RepairToByTime.push(repairToByTime);
					characterBattleData.totalRepairGiven += result.repNumber || 0;
				} else if (result.direction === 'by') {
					const repairFromByTime: RepairFromByTime = {
						timestamp: result.timestamp,
						repNumber: result.repNumber,
						module: result.module,
						repType: result.repType,
						gameId: result.gameId,
						combatMessage: result.combatMessage
					};
					characterBattleData.RepairFromByTime.push(repairFromByTime);
					characterBattleData.totalRepairTaken += result.repNumber || 0;
				}
			} else if (result.type === 'point') {
				const pointByTime: PointByTime = {
					timestamp: result.timestamp,
					pointType: result.pointType,
					pointFrom: result.pointFrom,
					pointTo: result.pointTo,
					combatMessage: result.combatMessage
				};
				characterBattleData.PointByTime.push(pointByTime);
			} else if (result.type === 'energyNeutralized') {
				const energyNutralizedByTime: EnergyNutralizedByTime = {
					timestamp: result.timestamp,
					gjNumber: result.gjNumber,
					gameId: result.gameId,
					module: result.module,
					combatMessage: result.combatMessage
				};
				characterBattleData.EnergyNutralizedByTime.push(energyNutralizedByTime);
				characterBattleData.totalEnergyNutralized += result.gjNumber || 0;
			} else if (result.type === 'energyDrained') {
				if (result.direction === 'from') {
					const energyDrainedFromByTime: EnergyDrainedFromByTime = {
						timestamp: result.timestamp,
						gjNumber: result.gjNumber,
						gameId: result.gameId,
						module: result.module,
						combatMessage: result.combatMessage
					};
					characterBattleData.EnergyDrainedFromByTime.push(energyDrainedFromByTime);
					characterBattleData.totalEnergyDrainedFrom += result.gjNumber || 0;
				} else if (result.direction === 'to') {
					const energyDrainedToByTime: EnergyDrainedToByTime = {
						timestamp: result.timestamp,
						gjNumber: result.gjNumber,
						gameId: result.gameId,
						module: result.module,
						combatMessage: result.combatMessage
					};
					characterBattleData.EnergyDrainedToByTime.push(energyDrainedToByTime);
					characterBattleData.totalEnergyDrainedTo += result.gjNumber || 0;
				}
			}
		});

		// Check if the characterBattleData object has empty arrays
		Object.keys(characterBattleData).forEach((key) => {
			if (Array.isArray(characterBattleData[key]) && characterBattleData[key].length === 0) {
				delete characterBattleData[key];
			}
		});

		// Check if all arrays are empty
		if (
			characterBattleData.DamageFromByTime === undefined &&
			characterBattleData.DamageToByTime === undefined &&
			characterBattleData.RepairFromByTime === undefined &&
			characterBattleData.RepairToByTime === undefined &&
			characterBattleData.PointByTime === undefined &&
			characterBattleData.EnergyNutralizedByTime === undefined &&
			characterBattleData.EnergyDrainedFromByTime === undefined &&
			characterBattleData.EnergyDrainedToByTime === undefined
		) {
			console.error('Invalid log');

			// Delete the character from the battle
			await BattleModel.updateOne(
				{ id: battleId },
				{ $pull: { characters: { name: characterName } } }
			);

			return { validCombat: false, errorMsgCombat: 'Log not in battle time range' };
		}

		// Push the characterBattleData object to the battle using mongoose
		await BattleModel.updateOne(
			{ id: battleId },
			{ $push: { characterBattleData: characterBattleData } }
		);

		console.log('Character battle data updated');

		return { validCombat: true, errorMsgCombat: '' };
	} catch (error) {
		console.error('Error:', error);
		return { validCombat: false, errorMsgCombat: 'Error parsing the log' };
	}
}
