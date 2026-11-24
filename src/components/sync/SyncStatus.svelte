<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The sync status control in the top bar (phase-4.md 11.1, 12.3; T14): where the open plan lives
	and whether it is kept, as an icon and a short label, on every layout. The icon's shape and the
	label tell the states apart, not only the colour (WCAG 1.4.1). The label shows where the bar has
	room (a container query: 1360 px and up, so the slot never moves); under it, and on a phone, the
	control is the icon alone, with a dot for a state that wants attention, and the label is in its
	accessible name and in the panel.

	It shows `statusOf(app)` (lib/sync/shown.ts): a component of its own is the adapter's only
	reader, so T7's controller changes nothing here. Pressing it opens the Sync panel, a lazy chunk
	(SyncPanel.svelte: a popover beside the control, a bottom sheet on a phone), loaded by the first
	press. Until it is loaded the button has no popover to toggle, so the first press asks for the
	chunk; once the panel is there, the declarative `popovertarget` toggles it (a script that also
	opened it would close it again in the same press).

	The live region says a change into a state that needs the person (queued, conflict, blocked,
	access, a failure), once per change and never for autosave (`viewOf`, lib/sync/status-view.ts).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import { statusOf } from '../../lib/sync/shown';
	import { viewOf } from '../../lib/sync/status-view';
	import Icon from '../Icon.svelte';
	import LazyMount from '../app/LazyMount.svelte';
	import Mark from '../app/Mark.svelte';

	interface Props {
		app: AppState;
		/** A phone: the panel is a bottom sheet, which the press opens itself. */
		phone?: boolean;
	}
	let { app, phone = false }: Props = $props();

	const id = $props.id();
	const popoverId = `sync-panel-${id}`;
	const s = $derived(statusOf(app));
	const v = $derived(viewOf(s));
	const name = $derived(strings.sync.name(v.label));

	/** Shared with the panel: it opens on the first press and tells when it is mounted. */
	const panel = $state({ open: false, ready: false });
	let asked = $state(false);

	function press(): void {
		if (phone || !panel.ready) {
			panel.open = true;
			asked = true;
		}
	}

	/** What a screen reader hears; the key of the state before this one decides, not the counts. */
	let said = $state('');
	let before = untrack(() => v.key);
	$effect(() => {
		const now = v;
		if (now.key === before) return;
		before = now.key;
		said = now.say ? strings.sync.name(now.label) : '';
	});
</script>

<button
	type="button"
	class="sync"
	data-testid="sync-status"
	data-kind={s.kind}
	data-tone={v.tone}
	aria-label={name}
	aria-haspopup={phone ? 'dialog' : undefined}
	aria-expanded={panel.open}
	popovertarget={phone ? undefined : popoverId}
	title={name}
	onclick={press}
>
	{#if v.icon === 'busy'}<Mark size={16} busy />{:else}<Icon name={v.icon} size={17} />{/if}
	<span class="label">{v.label}</span>
	<span class="pip" aria-hidden="true"></span>
</button>
<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{said}</div>
<LazyMount
	when={asked}
	load={() => import('./SyncPanel.svelte')}
	props={{ app, phone, id: popoverId, panel }}
/>

<style>
	.sync {
		position: relative;
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		gap: 8px;
		inline-size: var(--size-control);
		min-inline-size: var(--size-control);
		block-size: var(--size-control);
		padding: 0;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
	}
	.sync:hover {
		background: var(--color-row-hover);
	}
	.sync:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.sync :global(.icon),
	.sync :global(.mark) {
		color: var(--color-text-muted);
	}
	.sync[data-tone='ok'] :global(.icon) {
		color: var(--color-status-ok);
	}
	.sync[data-tone='attention'] :global(.icon) {
		color: var(--color-brass-ink);
	}
	.sync[data-tone='error'] :global(.icon) {
		color: var(--color-ruby);
	}
	/* A state that wants attention, where there is no label to say it. */
	.pip {
		position: absolute;
		inset-block-start: 3px;
		inset-inline-end: 3px;
		display: none;
		inline-size: 9px;
		block-size: 9px;
		border: 2px solid var(--color-surface);
		border-radius: 50%;
		box-sizing: content-box;
		background: var(--color-brass-deep);
	}
	.sync[data-tone='attention'] .pip,
	.sync[data-tone='error'] .pip {
		display: block;
	}
	.sync[data-tone='error'] .pip {
		background: var(--color-ruby);
	}
	/* The label shows where the bar has room; its slot has one width, so no state moves its neighbours. */
	.label {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	@container topbar (min-width: 1360px) {
		.sync {
			inline-size: 12.5rem;
			justify-content: flex-start;
			padding-inline: 12px;
		}
		.label {
			position: static;
			inline-size: auto;
			block-size: auto;
			min-inline-size: 0;
			overflow: hidden;
			clip-path: none;
			text-overflow: ellipsis;
		}
		.pip {
			display: none !important;
		}
	}
	@media (pointer: coarse) {
		.sync {
			min-block-size: var(--size-tap);
		}
	}
</style>
