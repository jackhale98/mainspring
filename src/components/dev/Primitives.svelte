<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Dev page only (/dev/primitives; see src/pages/dev/_primitives.astro): each shared UI primitive
	mounted with fake data and no engine, for the contract specs in tests/e2e/primitives/. The buttons
	and test ids here are the specs' handles. `window.__primitives` sets the toolbars' host width, so a
	spec can try a container width apart from the viewport's.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Menu, { type MenuItem } from '../ui/Menu.svelte';
	import Popover from '../ui/Popover.svelte';
	import Select from '../ui/Select.svelte';
	import Sheet from '../Sheet.svelte';
	import type { Detent } from '../../lib/inspector/detent';
	import RovingDemo from './RovingDemo.svelte';
	import ToolbarDemo from './ToolbarDemo.svelte';

	// --- Sheet
	let modal = $state(false);
	let details = $state(false);
	let detailsDetent = $state<Detent | undefined>('half');
	let drawer = $state(false);
	let closedBy = $state('');
	let lastLeft = $state(0);
	const LINES = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the sheet's content.`);

	// --- Menu
	const ITEMS: readonly MenuItem[] = [
		{ id: 'rename', label: 'Rename', show: 'F2', aria: 'F2' },
		{ id: 'up', label: 'Move up', show: 'Alt+Shift+↑' },
		{ id: 'off', label: 'Not now', disabled: true },
		{ id: 'delete', label: 'Delete', show: 'Del', separator: true },
	];
	let chosen = $state('');
	let openStart = $state(false);

	// --- Select
	let field = $state('b');
	let refused = $state('a');
	let sm = $state('b');
	let pill = $state('');
	let inline = $state('week');
	let overlay = $state('x');
	let picked = $state('');
	const OPTS = [
		{ value: 'a', label: 'Alpha' },
		{ value: 'b', label: 'Beta' },
		{ value: 'c', label: 'A rather long choice that has to be cut with an ellipsis' },
	];
	const PILL = [
		{ value: '', label: 'Replace with…' },
		{ value: 'ana', label: 'Ana' },
		{ value: 'ben', label: 'Ben' },
	];

	// --- Popover
	let popOpen = $state(false);

	// --- Toolbar
	let hostWidth = $state<number | null>(null);
	let picker = $state(true);

	onMount(() => {
		(window as unknown as { __primitives: unknown }).__primitives = {
			hostWidth: (w: number | null) => (hostWidth = w),
			picker: (on: boolean) => (picker = on),
			// A modal sheet makes the rest of the page inert, so a spec closes it through the owner's
			// `open`, as a tab change does in the app.
			closeAll: () => ((modal = false), (details = false), (drawer = false)),
		};
	});
</script>

<main>
	<h1>Shared UI primitives</h1>

	<section data-testid="prim-sheet" aria-labelledby="h-sheet">
		<h2 id="h-sheet">Sheet</h2>
		<div class="row">
			<button type="button" data-testid="open-modal" onclick={() => (modal = true)}
				>Open sheet</button
			>
			<button type="button" data-testid="open-details" onclick={() => (details = true)}
				>Open details</button
			>
			<button type="button" data-testid="open-drawer" onclick={() => (drawer = true)}
				>Open drawer</button
			>
			<button
				type="button"
				data-testid="close-by-prop"
				onclick={() => ((modal = false), (details = false), (drawer = false))}>Close by prop</button
			>
			<output data-testid="sheet-closed-by">{closedBy}</output>
			<output data-testid="sheet-left">{lastLeft}</output>
		</div>
	</section>

	<section data-testid="prim-menu" aria-labelledby="h-menu">
		<h2 id="h-menu">Menu</h2>
		<div class="row between">
			<Menu items={ITEMS} label="Row menu" onselect={(id) => (chosen = id)} align="start">
				{#snippet trigger({ attrs, toggle })}
					<button type="button" class="more" data-testid="menu-start" {...attrs} onclick={toggle}
						>⋯</button
					>
				{/snippet}
			</Menu>
			<output data-testid="menu-chosen">{chosen}</output>
			<Menu
				items={ITEMS}
				label="Row menu, end"
				onselect={(id) => (chosen = id)}
				align="end"
				bind:open={openStart}
			>
				{#snippet trigger({ attrs, toggle })}
					<button type="button" class="more" data-testid="menu-end" {...attrs} onclick={toggle}
						>⋯</button
					>
				{/snippet}
			</Menu>
		</div>
		<div class="row">
			<Menu
				items={ITEMS}
				label="Action menu"
				onselect={(id) => (chosen = id)}
				sheet
				sheetTestid="menu-sheet"
			>
				{#snippet trigger({ attrs, toggle })}
					<button
						type="button"
						class="more"
						data-testid="menu-sheet-trigger"
						{...attrs}
						onclick={toggle}>⋯</button
					>
				{/snippet}
			</Menu>
		</div>
		<div class="low">
			<Menu items={ITEMS} label="Row menu, low" onselect={(id) => (chosen = id)}>
				{#snippet trigger({ attrs, toggle })}
					<button type="button" class="more" data-testid="menu-low" {...attrs} onclick={toggle}
						>⋯</button
					>
				{/snippet}
			</Menu>
		</div>
	</section>

	<section data-testid="prim-select" aria-labelledby="h-select">
		<h2 id="h-select">Select</h2>
		<label for="sel-field">Field</label>
		<Select id="sel-field" value={field} options={OPTS} onchange={(v) => (field = v)} />
		<label for="sel-sm">Field, small</label>
		<Select id="sel-sm" size="sm" value={sm} options={OPTS} onchange={(v) => (sm = v)} />
		<label for="sel-disabled">Disabled</label>
		<Select id="sel-disabled" value="a" options={OPTS} disabled />
		<label for="sel-invalid">Invalid</label>
		<Select id="sel-invalid" value="a" options={OPTS} aria-invalid="true" />
		<label for="sel-refused">Refused: the plan keeps Alpha</label>
		<Select id="sel-refused" value={refused} options={OPTS} onchange={() => false} />
		<span class="row"
			><Select
				id="sel-pill"
				aria-label="Replace with"
				variant="pill"
				value={pill}
				options={PILL}
				onchange={(v, el) => ((picked = v), (el.value = ''))}
			/>
			<output data-testid="sel-picked">{picked}</output></span
		>
		<span class="chip" data-testid="sel-chip"
			><Select
				id="sel-inline"
				variant="inline"
				aria-label="Zoom"
				value={inline}
				options={[
					{ value: 'day', label: 'Day' },
					{ value: 'week', label: 'Week' },
				]}
				onchange={(v) => (inline = v)}
			/></span
		>
		<span class="chip glyph" data-testid="sel-overlay"
			>⇄<Select
				variant="overlay"
				aria-label="Replace"
				value={overlay}
				options={OPTS}
				onchange={(v) => (overlay = v)}
			/></span
		>
	</section>

	<section data-testid="prim-popover" aria-labelledby="h-pop">
		<h2 id="h-pop">Popover</h2>
		<div class="row between">
			<button type="button" data-testid="pop-center-button" popovertarget="pop-center"
				>Centred card</button
			>
			<button
				type="button"
				data-testid="pop-anchor-button"
				popovertarget="pop-anchor"
				aria-expanded={popOpen}>Anchored</button
			>
		</div>
		<Popover id="pop-center" title="Details" testid="pop-center">
			<p>A card that never exceeds the screen.</p>
			<button type="button">A button inside</button>
		</Popover>
		<Popover
			id="pop-anchor"
			label="Anchored card"
			testid="pop-anchor"
			placement="anchor"
			align="end"
			width="17rem"
			bind:open={popOpen}
		>
			<label for="pop-input">A field</label>
			<input id="pop-input" type="number" value="80" />
			<p>Beside its button, inside the viewport.</p>
		</Popover>
	</section>

	<section data-testid="prim-toolbar" aria-labelledby="h-tb">
		<h2 id="h-tb">Toolbar</h2>
		<ToolbarDemo width={hostWidth} {picker} />
	</section>

	<section data-testid="prim-grid" aria-labelledby="h-grid">
		<h2 id="h-grid">Grid focus</h2>
		<RovingDemo />
	</section>
</main>

<nav class="tabbar" data-testid="mock-tabbar" aria-label="Mock tab bar">
	<span>Plan</span><span>Gantt</span><span>People</span>
</nav>

<!-- A modal bottom sheet with a field first: the focus goes into it as it slides in. -->
<Sheet
	open={modal}
	side="bottom"
	title="Modal sheet"
	testid="sheet-modal"
	onclose={() => ((modal = false), (closedBy = 'modal'))}
	onleft={() => lastLeft++}
>
	<label for="sheet-field">A field</label>
	<input id="sheet-field" type="text" />
	{#each LINES as l (l)}<p>{l}</p>{/each}
</Sheet>

<!-- The task details' kind: not modal, above the tab bar, no focus taken. -->
<Sheet
	open={details}
	side="bottom"
	title="Details sheet"
	testid="sheet-details"
	modal={false}
	detent={detailsDetent}
	focusOnOpen={false}
	ondetent={(d) => (detailsDetent = d)}
	onclose={() => ((details = false), (closedBy = 'details'))}
	onleft={() => lastLeft++}
>
	<label for="details-field">A field</label>
	<input id="details-field" type="text" />
	{#each LINES as l (l)}<p>{l}</p>{/each}
</Sheet>

<Sheet
	open={drawer}
	side="start"
	title="Drawer"
	testid="sheet-drawer"
	onclose={() => ((drawer = false), (closedBy = 'drawer'))}
	onleft={() => lastLeft++}
>
	<p>The outline drawer.</p>
	<button type="button">A button inside</button>
</Sheet>

<style>
	main {
		padding: var(--space-4) var(--gutter) calc(var(--tabbar-clearance) + var(--space-6));
	}
	h1 {
		font-size: var(--text-lg);
	}
	section {
		margin-block-end: var(--space-6);
	}
	/* The toolbars have the whole width of the screen, as they do in the app. */
	section[data-testid='prim-toolbar'] {
		margin-inline: calc(-1 * var(--gutter));
	}
	section[data-testid='prim-toolbar'] > h2 {
		margin-inline: var(--gutter);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.between {
		justify-content: space-between;
	}
	button,
	.more {
		min-block-size: var(--size-tap);
		min-inline-size: var(--size-tap);
		padding-inline: var(--space-3);
	}
	.low {
		margin-block-start: 10rem;
	}
	label {
		display: block;
		margin-block: var(--space-2) 2px;
		font-size: var(--text-sm);
	}
	.chip {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-block-start: var(--space-2);
		padding-inline: 12px 26px;
		block-size: var(--size-control);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
	}
	.chip.glyph {
		inline-size: 2.5rem;
		padding-inline: 0;
		justify-content: center;
	}
	.tabbar {
		position: fixed;
		inset-inline: 0;
		inset-block-end: 0;
		z-index: 10;
		block-size: var(--tabbar-clearance);
		display: flex;
		justify-content: space-around;
		align-items: flex-start;
		padding-block-start: var(--space-2);
		background: var(--color-surface-sunken);
		border-block-start: 1px solid var(--color-border);
	}
</style>
