<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Undo and redo icon buttons: the workspace history (phase-2.md 6.7), the same as Mod-Z. Disabled
	while there is nothing to do; the tooltip names what would be undone.

	On a phone (`phone`) they are the top bar's pair, always visible, and the only undo there (an
	edit makes no toast; Toasts.svelte): the accessible names say what each would do ("Undo: Effort
	of Research: 3d to 4d"). A press and hold on Undo, or its context menu (the menu key, Shift+F10,
	and the long-press Android turns into one), opens the History sheet (HistorySheet.svelte), which
	rewinds several steps; the status card has a row for the same sheet, for anyone who cannot hold.
	The hold is src/lib/gesture/button-hold.ts; the click that ends a hold is not an undo.
-->
<script lang="ts">
	import { ButtonHold } from '../../lib/gesture';
	import type { AppState } from '../../lib/state/app.svelte';
	import { historyStrings, strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	let { app, phone = false }: { app: AppState; phone?: boolean } = $props();

	const undoName = $derived(
		phone && !app.history.canUndo ? historyStrings.undoNone : app.history.undoLabel,
	);
	const redoName = $derived(
		phone && !app.history.canRedo ? historyStrings.redoNone : app.history.redoLabel,
	);

	const hold = new ButtonHold(() => (app.historyOpen = true), {
		setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
		clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
	});

	function undo(): void {
		if (phone && hold.consumeClick()) return;
		app.history.undo();
	}

	/** The menu key, Shift+F10, a right click and Android's long-press: all open the History. */
	function menu(e: MouseEvent): void {
		if (!phone) return;
		e.preventDefault();
		hold.markFired();
		if (app.history.canUndo) app.historyOpen = true;
	}
</script>

<div class="pair" class:phone role="group" aria-label={strings.topBar.history}>
	<button
		type="button"
		data-testid="undo"
		aria-label={phone ? undoName : strings.topBar.undo}
		title={app.history.undoLabel}
		disabled={!app.history.canUndo}
		onclick={undo}
		onpointerdown={phone ? (e) => hold.down(e) : undefined}
		onpointermove={phone ? (e) => hold.move(e) : undefined}
		onpointerup={phone ? () => hold.end() : undefined}
		onpointercancel={phone ? () => hold.end() : undefined}
		oncontextmenu={menu}
	>
		<Icon name="undo" size={17} />
	</button>
	<button
		type="button"
		data-testid="redo"
		aria-label={phone ? redoName : strings.topBar.redo}
		title={app.history.redoLabel}
		disabled={!app.history.canRedo}
		onclick={() => app.history.redo()}
	>
		<Icon name="redo" size={17} />
	</button>
</div>

<style>
	.pair {
		display: inline-flex;
		gap: 2px;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: var(--size-control);
		block-size: var(--size-control);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background-color var(--motion-fast);
	}
	/* One pill for the pair, like the status button beside it; each half is a 44 px target. */
	.pair.phone {
		flex: none;
		gap: 0;
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow:
			inset 0 0 0 1px var(--color-border-strong),
			var(--shadow-chip);
	}
	.phone button {
		flex: none;
		inline-size: var(--size-tap);
		block-size: var(--size-tap);
		color: var(--color-text);
		/* A hold is a press, not a text selection or a callout (iOS); the tap is not delayed. */
		-webkit-touch-callout: none;
		-webkit-user-select: none;
		user-select: none;
		touch-action: manipulation;
	}
	button:hover:not(:disabled) {
		background: var(--color-row-hover);
		color: var(--color-text);
	}
	/* Disabled is still readable: 3:1 is the floor for a control that is shown (WCAG 1.4.11). */
	button:disabled {
		color: var(--color-text-faint);
		opacity: 0.6;
		cursor: default;
	}
	.phone button:disabled {
		color: var(--color-text-muted);
	}
</style>
