<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Sync panel (phase-4.md 11.1; T14), the lazy chunk behind the status control: a popover beside
	the control on a desktop and a tablet (the shared Popover, anchored to the control's button by its
	`popovertarget`), the shared bottom Sheet at half height on a phone. The content is
	SyncPanelBody.svelte in both. `panel` is shared with the control: `open` is the sheet's state or
	the popover's first opening (the control asked for the chunk and the popover opens as it mounts),
	and `ready` tells the control that the declarative `popovertarget` has a popover to toggle now.

	11.1's table makes a tablet's panel a bottom sheet; it is the popover here, as T14's brief says
	(the control sits in the top bar on a tablet, as on a desktop, and a popover beside it keeps the
	chart in view). A phone is the sheet.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Detent } from '../../lib/inspector/detent';
	import type { AppState } from '../../lib/state/app.svelte';
	import { syncStrings } from '../../lib/strings-sync';
	import Sheet from '../Sheet.svelte';
	import Popover from '../ui/Popover.svelte';
	import SyncPanelBody from './SyncPanelBody.svelte';

	interface Props {
		app: AppState;
		phone: boolean;
		/** The popover's id: the control's `popovertarget`. */
		id: string;
		panel: { open: boolean; ready: boolean };
	}
	let { app, phone, id, panel }: Props = $props();

	let detent = $state<Detent | undefined>('half');
	onMount(() => {
		panel.ready = true;
		return () => (panel.ready = false);
	});
</script>

{#if phone}
	<Sheet
		open={panel.open}
		side="bottom"
		title={syncStrings.title}
		testid="sync-panel"
		{detent}
		ondetent={(d) => (detent = d)}
		onclose={() => (panel.open = false)}
	>
		<SyncPanelBody {app} />
	</Sheet>
{:else}
	<Popover
		{id}
		title={syncStrings.title}
		placement="anchor"
		align="end"
		width="22rem"
		testid="sync-panel"
		bind:open={panel.open}
	>
		<SyncPanelBody {app} />
	</Popover>
{/if}
