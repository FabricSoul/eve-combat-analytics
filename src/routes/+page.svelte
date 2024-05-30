<script lang="ts">
	import { Autocomplete, popup } from '@skeletonlabs/skeleton';
	import type { PopupSettings, AutocompleteOption } from '@skeletonlabs/skeleton';
	import type { PageData } from './$types';
	import { DateTime } from 'luxon';

	let popupSettings: PopupSettings = {
		event: 'focus-click',
		target: 'popupAutocomplete',
		placement: 'bottom'
	};
	let textInput: string = '';
	let errorMessage: string = '';
	let systems: AutocompleteOption<string>[] = [];

	async function fetchOptions() {
		const formData = new FormData();
		formData.append('query', textInput);

		const response = await fetch('?/search', {
			method: 'POST',
			body: formData
		});
		let data = await response.json();

		// Construct the options array
		// data: "[[1,2],\"Hek\",\"Ghekon\"]"
		const parsedData = JSON.parse(data.data);
		systems = parsedData.slice(1).map((system: string) => ({
			label: system,
			value: system
		}));
		console.log('Systems:', systems);
	}

	function onPopupSelect(event: CustomEvent<AutocompleteOption<string>>): void {
		console.log('Selected:', event.detail);
		textInput = event.detail.label;
	}

	import Flatpickr from 'svelte-flatpickr';
	import 'flatpickr/dist/flatpickr.css';
	import { enhance } from '$app/forms';

	export let data: PageData;
	const battles = data.battles;

	let currentDateTime = DateTime.local();
	let startDateTime = currentDateTime.minus({ hours: 1 });

	let dateUTC = [startDateTime.toJSDate(), currentDateTime.toJSDate()];

	const options = {
		enableTime: true,
		dateFormat: 'yyyy-MM-dd HH:mm',
		time_24hr: true,
		mode: 'range',
		maxDate: currentDateTime.toJSDate(),
		utc: true,
		formatDate: (date, format) => {
			return DateTime.fromJSDate(date).toUTC().toFormat(format);
		},
		parseDate: (dateString, format) => {
			return DateTime.fromFormat(dateString, format, { zone: 'utc' }).toJSDate();
		}
	};

	function formatUTCDate(date: Date) {
		return DateTime.fromJSDate(date).toUTC().toFormat('yyyy/MM/dd HH:mm');
	}
</script>

<div class="card grow max-w-3xl">
	<form
		method="POST"
		action="?/submit"
		use:enhance={({ formElement, formData, cancel, submitter }) => {
			// `formElement` is this `<form>` element
			// `formData` is its `FormData` object that's about to be submitted
			try {
				formData.set('system', textInput);
				formData.set('dateStart', dateUTC[0].toString());
				formData.set('dateEnd', dateUTC[1].toString());
				formData.set('characters', JSON.stringify([]));
				console.log('Form Data:', formData);
			} catch (e) {
				console.log(e);
			}

			// `action` is the URL to which the form is posted
			// calling `cancel()` will prevent the submission
			// Perform validation
			if (!textInput || !dateUTC || dateUTC.length !== 2) {
				errorMessage = 'Please fill in all the required fields.';
				cancel();
			}

			if (systems[0].value !== textInput) {
				errorMessage = 'Please select a valid system.';
				cancel();
			}

			// `submitter` is the `HTMLElement` that caused the form to be submitted
			console.log('Submitter:', submitter);

			return async ({ update }) => {
				await update();
			};
		}}
	>
		<div class="mt-4 mb-8 ml-8 mr-8">
			<h3>Create a battle</h3>
			<div class="flex marker:flex-row justify-left space-x-6 mt-2">
				<div class="flex flex-col space-y-2">
					<div><p><i class="fa-solid fa-sun"></i> System</p></div>
					<div>
						<input
							class="input autocomplete"
							type="search"
							name="autocomplete-search"
							bind:value={textInput}
							placeholder="Search..."
							use:popup={popupSettings}
							on:input={fetchOptions}
						/>
						<div
							data-popup="popupAutocomplete"
							class="card w-full max-h-48 p-4 overflow-y-auto max-w-48"
							tabindex="-1"
						>
							<Autocomplete bind:input={textInput} options={systems} on:selection={onPopupSelect} />
						</div>
					</div>
				</div>
				<div class="flex flex-col space-y-2">
					<div><p><i class="fa-solid fa-clock"></i> EVE Time</p></div>
					<div class="min-w-80">
						<Flatpickr {options} bind:value={dateUTC} element="#my-picker">
							<div class="input-group" id="my-picker">
								<input type="text" placeholder="Select Date.." data-input class="input" />
							</div>
						</Flatpickr>
					</div>
				</div>
				<div class="flex flex-col space-y-2">
					<div><br /></div>
					<div>
						<button type="submit" class="btn variant-filled"
							><i class="fa-solid fa-plus"></i> Add</button
						>
					</div>
				</div>
			</div>
			{#if errorMessage}
				<div class="text-error-500">{errorMessage}</div>
			{/if}
		</div>
	</form>
</div>

<div class="max-w-3xl">
	<h1>Recent battles</h1>
	{#if battles.length === 0}
		<p>No battles found.</p>
	{:else if battles.length > 0}
		{#each battles as battle}
			<a href="/battle/{battle.id}">
				<div class="card grow">
					<div class="mt-4 ml-8 mr-8 pt-4 pb-4">
						<div class="flex marker:flex-row justify-items-strech space-x-20 mt-2">
							<div>
								<div>
									<p><i class="fa-solid fa-sun"></i> System</p>
								</div>
								<div>{battle.system}</div>
							</div>
							<div>
								<div><p><i class="fa-solid fa-clock"></i> Start time</p></div>
								<div>
									{formatUTCDate(new Date(battle.dateStart))}
								</div>
							</div>
							<div>
								<div><p><i class="fa-solid fa-clock"></i> End Time</p></div>
								<div>
									{formatUTCDate(new Date(battle.dateEnd))}
								</div>
							</div>
							<div>
								<div><p><i class="fa-solid fa-users"></i> Participants</p></div>
								<div>{battle.characters.length}</div>
							</div>
						</div>
					</div>
				</div></a
			>
		{/each}
	{:else}
		<section class="card grow">
			<div class="p-4 space-y-4">
				<div class="placeholder" />
				<div class="grid grid-cols-3 gap-8">
					<div class="placeholder" />
					<div class="placeholder" />
					<div class="placeholder" />
				</div>
				<div class="grid grid-cols-4 gap-4">
					<div class="placeholder" />
					<div class="placeholder" />
					<div class="placeholder" />
					<div class="placeholder" />
				</div>
			</div>
		</section>
	{/if}
</div>
