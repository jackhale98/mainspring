<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The view switcher (phase-3.md 9.1, 18.10): Gantt, Workload, Resources and Calendar, the leading
	group of the view toolbar on a desktop and a tablet. The Gantt's toolbar (`GanttToolbar`'s
	`lead`) and the People views' bar (`ViewBar`) each place one; T14's heatmap toolbar places it the
	same way. A phone has none: its tab bar has People. Shown in Split and Visual, where a chart
	panel is.

	It is a radio group (SegmentTabs): it sits inside the panel it changes. It narrows with the
	toolbar it is in (the nearest container, as the Gantt's chips do): the full names, then the icons
	with the name of the chosen view, then one compact menu button (a select) when the toolbar is
	too narrow for four icons beside the chips.

	Each copy has its own ids (`scope`), and a change of view puts the focus on the chosen view in
	the copy that is on screen then: the Gantt hides when another view is chosen, and with it the
	control that was pressed. The change is not announced separately: the chosen radio says it.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { IconName } from '../../lib/icons';
	import type { View } from '../../lib/state/selection.svelte';
	import { VIEWS } from '../../lib/workload/prefs';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';
	import SegmentTabs from './SegmentTabs.svelte';

	interface Props {
		view: View;
		onchange: (view: View) => void;
		/** Which copy this is (ids and the focus return): 'gantt' or 'people'. */
		scope: string;
	}
	let { view, onchange, scope }: Props = $props();

	const S = strings.people;
	const ICON: Record<View, IconName> = {
		gantt: 'visual',
		workload: 'grid',
		resources: 'rows',
		calendar: 'calendar',
	};
	const ITEMS = VIEWS.map((id) => ({ id, label: S.view[id], icon: ICON[id] }));

	/**
	 * Puts the focus on the chosen view, in whichever copy shows now (the other is hidden). The copy
	 * of a People view that was never shown mounts a frame or two after the choice, so it looks for
	 * a few frames.
	 */
	async function refocus(id: View): Promise<void> {
		await tick();
		for (let frame = 0; frame < 20; frame++) {
			const copies = document.querySelectorAll<HTMLElement>(
				`[data-view-switcher] [data-choice="${id}"], [data-view-switcher] select`,
			);
			for (const el of copies) {
				if (el.getClientRects().length > 0) {
					el.focus();
					return;
				}
			}
			await new Promise((r) => requestAnimationFrame(r));
		}
	}

	function pick(next: View): void {
		if (next !== view) onchange(next);
	}
</script>

<div class="switcher" data-view-switcher={scope}>
	<div class="full">
		<SegmentTabs
			items={ITEMS}
			value={view}
			onchange={pick}
			label={S.switcher}
			prefix="view-{scope}"
			kind="radios"
			{refocus}
		/>
	</div>
	<label class="compact">
		<Icon name={ICON[view]} size={14} />
		<span class="sr-only">{S.switcher}</span>
		<select
			value={view}
			aria-label={S.switcher}
			onchange={(e) => {
				pick(e.currentTarget.value as View);
				void refocus(e.currentTarget.value as View);
			}}
		>
			{#each ITEMS as item (item.id)}
				<option value={item.id}>{item.label}</option>
			{/each}
		</select>
		<span class="caret"><Icon name="chevronDown" size={12} /></span>
	</label>
</div>

<style>
	.switcher {
		flex: none;
		display: flex;
		align-items: center;
	}
	.compact {
		display: none;
	}
	.compact,
	.compact * {
		box-sizing: border-box;
	}
	/*
	 * The tiers follow what fits beside the Gantt's chips (GanttToolbar), by the width of the
	 * toolbar (the nearest container), as the chips themselves narrow:
	 *   1380 px and up   the names and icons (SegmentTabs);
	 *   1050 to 1379     icons, the name of the chosen view;
	 *   900 to 1049      one menu button: the chips still have their labels and the legend of the
	 *                    today and status lines, which take the room four icons would (a desktop at
	 *                    1280 with the details docked is here);
	 *   560 to 899       icons again: the chips are compact there (no legend, no People label);
	 *   under 560        one menu button (Split beside the editor, a small tablet).
	 */
	@container (min-width: 900px) and (max-width: 1049px) {
		.full {
			display: none;
		}
		.compact {
			display: inline-flex;
		}
	}
	@container (max-width: 559px) {
		.full {
			display: none;
		}
		.compact {
			display: inline-flex;
		}
	}
	.compact {
		position: relative;
		align-items: center;
		gap: 7px;
		block-size: var(--gantt-chip-height, 2rem);
		padding-inline: 12px 26px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
		color: var(--color-text);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.compact:has(select:focus-visible) {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.compact {
			min-block-size: var(--size-tap);
		}
	}
	select {
		appearance: none;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		outline: none;
		padding: 0;
	}
	.caret {
		position: absolute;
		inset-inline-end: 10px;
		display: grid;
		color: var(--color-text-muted);
		pointer-events: none;
	}
</style>
