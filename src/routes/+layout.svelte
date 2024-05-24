<script lang="ts">
	import '../app.postcss';

	// Highlight JS
	import hljs from 'highlight.js/lib/core';
	import 'highlight.js/styles/github-dark.css';
	import { AppBar, LightSwitch, storeHighlightJs } from '@skeletonlabs/skeleton';
	import xml from 'highlight.js/lib/languages/xml'; // for HTML
	import css from 'highlight.js/lib/languages/css';
	import javascript from 'highlight.js/lib/languages/javascript';
	import typescript from 'highlight.js/lib/languages/typescript';

	hljs.registerLanguage('xml', xml); // for HTML
	hljs.registerLanguage('css', css);
	hljs.registerLanguage('javascript', javascript);
	hljs.registerLanguage('typescript', typescript);
	storeHighlightJs.set(hljs);

	// Floating UI for Popups
	import { computePosition, autoUpdate, flip, shift, offset, arrow } from '@floating-ui/dom';
	import { storePopup } from '@skeletonlabs/skeleton';
	storePopup.set({ computePosition, autoUpdate, flip, shift, offset, arrow });
</script>

<div>
	<AppBar
		gridColumns="grid-cols-3"
		slotLead="place-self-left"
		slotTrail="place-content-end"
		slotDefault="place-content-end"
	>
		<svelte:fragment slot="lead">
			<a href="/"><h1>EVE DPS</h1></a>
		</svelte:fragment>
		<svelte:fragment slot="trail"><LightSwitch /></svelte:fragment>
	</AppBar>
	<div class="mx-auto max-w-3xl mt-16 mb-28">
		<div
			class="container h-full mx-auto flex justify-center items-center flex-col space-y-8 min-w-full"
		>
			<slot />
		</div>
	</div>
	<!-- Footer -->
	<AppBar
		slotDefault="place-content-center"
		gridColumns="grid-cols-1"
		class="absolute inset-x-0 bottom-0"
	>
		<div class="flex flex-col items-center">
			<div class="text-sm mb-2">
				All <a href="/legal" class="hover:text-sky-400 hover:underline">EVE related materials</a>
				are property of
				<a href="https://www.ccpgames.com/" class="hover:text-sky-400 hover:underline">CCP Games</a>
			</div>
			<div class="flex space-x-4 text-sm">
				<a href="/about" class="hover:text-sky-400 hover:underline"
					><i class="fa-solid fa-circle-info"></i> About</a
				>
				<a href="https://discord.gg/GfPcWKyN9u" class="hover:text-sky-400 hover:underline"
					><i class="fa-brands fa-discord"></i> Discord</a
				>
				<a href="https://github.com/FabricSoul/eve-dps" class="hover:text-sky-400 hover:underline"
					><i class="fa-brands fa-github"></i> GitHub</a
				>
			</div>
		</div>
	</AppBar>
</div>
