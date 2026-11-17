<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Plan health as a bottom sheet (phase-3.md 9.1, 9.2): on a tablet from the Health button, on a
	phone from the status button's card ("Plan health: N"), full height there (18.10). It is not
	modal, as the task details' sheet is not: the top bar (a phone's Undo and Redo) and the tab bar
	stay in reach, and a fix's toast and its Undo are never behind a backdrop. Full height stops
	below the top bar (Sheet.svelte). Escape or the close button return the focus to the Health
	button where there is one. A lazy chunk with the panel: it is mounted when the panel is first
	asked for on these layouts and then kept (the Sheet's `open` shows it).
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import Sheet from '../Sheet.svelte';
	import HealthPanel from './HealthPanel.svelte';

	interface Props {
		app: AppState;
		/** A phone: the sheet opens at full height. */
		phone: boolean;
	}
	let { app, phone }: Props = $props();

	const health = $derived(app.health);
	$effect(() => {
		if (health.open) health.detent = phone ? 'full' : 'half';
	});

	/** The Health button, when there is one on screen: the focus goes back to it. */
	function back(): boolean {
		const button = document.querySelector<HTMLElement>('[data-testid="health-button"]');
		if (!button || button.getClientRects().length === 0) return false;
		button.focus();
		return true;
	}
</script>

<Sheet
	open={health.open}
	side="bottom"
	modal={false}
	focusOnOpen={false}
	title={strings.health.title}
	closeLabel={strings.health.close}
	detent={health.detent}
	ondetent={(d) => (health.detent = d)}
	onheight={(h) => (health.sheetHeight = h)}
	onreturn={back}
	onclose={() => health.hide()}
>
	<HealthPanel {app} sheet />
</Sheet>
