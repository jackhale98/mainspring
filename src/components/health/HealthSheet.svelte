<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Plan health as a bottom sheet (phase-3.md 9.1, 9.2): on a tablet from the Health button, on a
	phone from the status button's card ("Plan health: N"), full height there (18.10). It is modal:
	the page behind is inert while it is open, Escape or the close button return the focus, and the
	sheet's own header is the panel's title. A lazy chunk with the panel: it is mounted when the
	panel is first asked for on these layouts and then kept (the Sheet's `open` shows it).
-->
<script lang="ts">
	import type { Detent } from '../../lib/inspector/detent';
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

	let detent = $state<Detent>('half');
	$effect(() => {
		if (app.health.open) detent = phone ? 'full' : 'half';
	});
</script>

<Sheet
	open={app.health.open}
	side="bottom"
	title={strings.health.title}
	closeLabel={strings.health.close}
	{detent}
	ondetent={(d) => (detent = d)}
	onclose={() => app.health.hide()}
>
	<HealthPanel {app} sheet />
</Sheet>
