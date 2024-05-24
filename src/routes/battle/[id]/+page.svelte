<script lang="ts">
	import { FileDropzone } from '@skeletonlabs/skeleton';

	import type { PageData } from './$types';

	export let data: PageData;
	const battle = data.battle;
	console.log(battle);

	let files: FileList;
	let errorMessage: string = '';

	function onChangeHandler(e: Event): void {
		console.log('file data:', e);
		console.log('files:', files);

		if (files[0].type !== 'text/plain') {
			errorMessage = 'Only text files are allowed';
			return;
		}
	}
</script>

<div>
	{#if battle}
		<h1>System: {battle.system}</h1>
		<h1>{battle.dateStart}</h1>
		<h1>{battle.dateEnd}</h1>
		{#if battle.characters.length > 0}
			{#each battle.characters as character}
				<h1>{character.name}</h1>
			{/each}
		{:else}
			<h1>No characters found, consider upload combat log?</h1>
		{/if}
	{:else}
		<h1>No battle found</h1>
	{/if}
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
