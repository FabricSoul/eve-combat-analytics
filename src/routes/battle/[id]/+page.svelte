<script lang="ts">
	import { FileDropzone } from '@skeletonlabs/skeleton';
	import type { PageData } from './$types';
	import { generateLineChartDatasets, generatePieChartDatasets } from '$lib/util/datasetGenerators';
	import { onMount } from 'svelte';
	import Chart from 'chart.js/auto';
	import 'chartjs-adapter-date-fns';
	import { lineChartOptions } from '$lib/models/chartDataset';
	import { DateTime } from 'luxon';

	export let data: PageData;
	const battle = data.battle;

	const loading = false;

	let files: FileList;
	let errorMessage: string = '';

	async function onChangeHandler(e: Event): Promise<void> {
		if (files[0].type !== 'text/plain') {
			errorMessage = 'Only text files are allowed';
			return;
		}

		// Pass the file to server
		const formData = new FormData();
		formData.append('file', files[0]);
		if (battle) {
			formData.append('battleId', battle.id);
		}

		const response = await fetch(`?/upload`, {
			method: 'POST',
			body: formData
		});

		if (!response.ok) {
			const errorText = await response.json();
			errorMessage = errorText.error.message;
		} else {
			errorMessage = ''; // Clear the error message if the upload is successful
			window.location.reload();
		}
	}

	let damageToChart: any;
	let damageFromChart: any;
	let repairFromChart: any;
	let repairToChart: any;
	let energyNutralizedChart: any;
	let energyDrainedFromChart: any;
	let energyDrainedToChart: any;
	let totalDamageDeltChart: any;
	let toalDamageTakenChart: any;
	let totalRepairGivenChart: any;
	let totalRepairTakenChart: any;
	let totalEnergyNutralizedChart: any;
	let totalEnergyDrainedFromChart: any;
	let totalEnergyDrainedToChart: any;

	onMount(async () => {
		if (!battle) {
			return;
		}
		const zoomPlugin = await import('chartjs-plugin-zoom');

		Chart.register(zoomPlugin);

		const damageToDatasets = generateLineChartDatasets(battle, 'DamageToByTime');
		const damageFromDatasets = generateLineChartDatasets(battle, 'DamageFromByTime');
		const repairFromDatasets = generateLineChartDatasets(battle, 'RepairFromByTime');
		const repairToDatasets = generateLineChartDatasets(battle, 'RepairToByTime');
		// const energyNutralizedDatasets = generateLineChartDatasets(battle, 'EnergyNutralizedByTime');
		// const energyDrainedFromDatasets = generateLineChartDatasets(battle, 'EnergyDrainedFromByTime');
		// const energyDrainedToDatasets = generateLineChartDatasets(battle, 'EnergyDrainedToByTime');

		new Chart(damageToChart, {
			type: 'line',
			data: {
				datasets: damageToDatasets
			},
			options: lineChartOptions
		});

		new Chart(damageFromChart, {
			type: 'line',
			data: {
				datasets: damageFromDatasets
			},
			options: lineChartOptions
		});

		new Chart(repairFromChart, {
			type: 'line',
			data: {
				datasets: repairFromDatasets
			},
			options: lineChartOptions
		});

		new Chart(repairToChart, {
			type: 'line',
			data: {
				datasets: repairToDatasets
			},
			options: lineChartOptions
		});

		// new Chart(energyNutralizedChart, {
		// 	type: 'line',
		// 	data: {
		// 		datasets: energyNutralizedDatasets
		// 	},
		// 	options: lineChartOptions
		// });

		// new Chart(energyDrainedFromChart, {
		// 	type: 'line',
		// 	data: {
		// 		datasets: energyDrainedFromDatasets
		// 	},
		// 	options: lineChartOptions
		// });

		// new Chart(energyDrainedToChart, {
		// 	type: 'line',
		// 	data: {
		// 		datasets: energyDrainedToDatasets
		// 	},
		// 	options: lineChartOptions
		// });

		const totalDamageDelt = generatePieChartDatasets(battle, 'totalDamageDelt');
		const toalDamageTaken = generatePieChartDatasets(battle, 'totalDamageTaken');
		const totalRepairGiven = generatePieChartDatasets(battle, 'totalRepairGiven');
		const totalRepairTaken = generatePieChartDatasets(battle, 'totalRepairTaken');
		// const totalEnergyNutralized = generatePieChartDatasets(battle, 'totalEnergyNutralized');
		// const totalEnergyDrainedFrom = generatePieChartDatasets(battle, 'totalEnergyDrainedFrom');
		// const totalEnergyDrainedTo = generatePieChartDatasets(battle, 'totalEnergyDrainedTo');

		new Chart(totalDamageDeltChart, {
			type: 'pie',
			data: totalDamageDelt
		});

		new Chart(toalDamageTakenChart, {
			type: 'pie',
			data: toalDamageTaken
		});

		new Chart(totalRepairGivenChart, {
			type: 'pie',
			data: totalRepairGiven
		});

		new Chart(totalRepairTakenChart, {
			type: 'pie',
			data: totalRepairTaken
		});

		// new Chart(totalEnergyNutralizedChart, {
		// 	type: 'pie',
		// 	data: totalEnergyNutralized
		// });

		// new Chart(totalEnergyDrainedFromChart, {
		// 	type: 'pie',
		// 	data: totalEnergyDrainedFrom
		// });

		// new Chart(totalEnergyDrainedToChart, {
		// 	type: 'pie',
		// 	data: totalEnergyDrainedTo
		// });
	});
</script>

<svelte:head>
	<!-- SEO Meta Tags -->
	<title>{battle.system} Battle | EVE Combat Analytics</title>
	<meta
		name="description"
		content="Analyze the battle in {battle.system} involving {battle.characters
			.length} characters using EVE Combat Analytics. Gain insights into damage dealt, damage received, repairs."
	/>
	<meta
		name="keywords"
		content="EVE Online, {battle.system}, combat analytics, combat logs, player performance, data visualization"
	/>
	<meta name="author" content="Fabric Soul" />

	<!-- Open Graph Meta Tags -->
	<meta property="og:site_name" content="EVE Combat Analytics" />
	<meta property="og:url" content="https://ca.eveutil.org/battle/{battle.id}" />
	<meta property="og:type" content="website" />
	<meta
		property="og:title"
		content="{battle.system} Battle with {battle.characters
			.length} Characters | EVE Combat Analytics"
	/>
	<meta
		property="og:description"
		content="Analyze the battle in {battle.system} involving {battle.characters
			.length} characters using EVE Combat Analytics. Gain insights into damage dealt, damage received, repairs."
	/>
</svelte:head>

<div class="min-w-3xl card p-4 flex flex-col space-y-2">
	{#if battle}
		<h1>System: {battle.system}</h1>
		<h1>
			<i class="fa-solid fa-clock"></i>
			Date Start:
		</h1>
		<p>{DateTime.fromJSDate(battle.dateStart).toUTC().toFormat('yyyy-MM-dd HH:mm:ss')}</p>

		<h1>
			<i class="fa-solid fa-clock"></i>Date End:
		</h1>
		<p>{DateTime.fromJSDate(battle.dateEnd).toUTC().toFormat('yyyy-MM-dd HH:mm:ss')}</p>

		{#if loading}
			<section class="card w-full">
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

		{#if battle.characters.length > 0}
			<h1>Characters:</h1>
			<ul class="list">
				{#each battle.characters as character}
					<li>
						<span><i class="fa-solid fa-user"></i></span>
						<span>{character.name}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<h1>No characters found, consider upload combat log?</h1>
		{/if}
	{:else}
		<h1>No battle found</h1>
	{/if}
</div>

{#if battle && battle.characters.length > 0}
	<h1>Damage By Time</h1>
	<div class="w-full px-16 bg-surface-100" style="position: relative; height: 75vh;">
		<canvas bind:this={damageToChart} />
	</div>
	<h1>Damage Recieved By Time</h1>
	<div class="w-full px-16 bg-surface-100" style="position: relative; height: 75vh;">
		<canvas bind:this={damageFromChart} />
	</div>
	<h1>Repair By Time</h1>
	<div class="w-full px-16 bg-surface-100" style="position: relative; height: 75vh;">
		<canvas bind:this={repairFromChart} />
	</div>
	<h1>Repair Recieved By Time</h1>
	<div class="w-full px-16 bg-surface-100" style="position: relative; height: 75vh;">
		<canvas bind:this={repairToChart} />
	</div>
	<!-- <h1>Energy Nutralized By Time</h1>
	<div class="w-full px-16 bg-surface-100" style="position: relative; height: 75vh;">
		<canvas bind:this={energyNutralizedChart} />
	</div>
	<h1>Energy Drained By Time</h1>
	<div class="w-full px-16 bg-surface-100" style="position: relative; height: 75vh;">
		<canvas bind:this={energyDrainedFromChart} />
	</div>
	<h1>Energy Drained Recieved By Time</h1>
	<div class="w-full px-16 bg-surface-100" style="position: relative; height: 75vh;">
		<canvas bind:this={energyDrainedToChart} />
	</div> -->
	<div class="flex flex-row">
		<div class="min-w-96">
			<h1>Total Damage Delt</h1>
			<canvas bind:this={totalDamageDeltChart} />
		</div>
		<div class="min-w-96">
			<h1>Total Damage Taken</h1>
			<canvas bind:this={toalDamageTakenChart} />
		</div>
		<div class="min-w-96">
			<h1>Total Repair Given</h1>
			<canvas bind:this={totalRepairGivenChart} />
		</div>
		<div class="min-w-96">
			<h1>Total Repair Taken</h1>
			<canvas bind:this={totalRepairTakenChart} />
		</div>
	</div>
	<!-- <div class="min-w-96">
		<h1>Total Energy Nutralized</h1>
		<canvas bind:this={totalEnergyNutralizedChart} />
	</div>
	<div class="min-w-96">
		<h1>Total Energy Drained From</h1>
		<canvas bind:this={totalEnergyDrainedFromChart} />
	</div>
	<div class="min-w-96">
		<h1>Total Energy Drained To</h1>
		<canvas bind:this={totalEnergyDrainedToChart} />
	</div> -->
{/if}

<div class="max-w-3xl">
	{#if errorMessage}
		<p class="text-error-500">{errorMessage}</p>
	{/if}
	<FileDropzone name="files" bind:files on:change={onChangeHandler}>
		<svelte:fragment slot="lead"
			><i class="fa-solid fa-file scale-150" style="font-size: 3rem;"></i></svelte:fragment
		>
		<svelte:fragment slot="message"><p>Upload a file or drag and drop</p></svelte:fragment>
		<svelte:fragment slot="meta"><p>txt allowed</p></svelte:fragment>
	</FileDropzone>
</div>
