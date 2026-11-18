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
	import Select from '../ui/Select.svelte';
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

<div class="switcher" data-view-switcher={scope} data-narrow="own">
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
		<Select
			variant="inline"
			value={view}
			aria-label={S.switcher}
			options={ITEMS.map((item) => ({ value: item.id, label: item.label }))}
			onchange={(v) => {
				pick(v as View);
				void refocus(v as View);
			}}
		/>
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
	 * toolbar (the nearest container):
	 *   1380 px and up   the names and icons (SegmentTabs);
	 *   1050 to 1379     icons, the name of the chosen view;
	 *   under 1050       one menu button. Four icons there push the chips under the details drawer
	 *                    in Split, and leave the selected task's line no room (a desktop at 1280
	 *                    with the details docked, Split beside the editor, a tablet).
	 */
	@container (max-width: 1049px) {
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
	.compact:has(:global(select:focus-visible)) {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.compact {
			min-block-size: var(--size-tap);
		}
	}
	/* Under 900 px (Split beside the editor) the button is the view's icon and the caret only, so
	   the Gantt's chips stay clear of the details drawer. The select still covers the whole button
	   and keeps its name; the chosen view's name is the icon there. */
	@container (max-width: 899px) {
		.compact {
			padding-inline: 10px 24px;
		}
		.compact :global(select) {
			position: absolute;
			inset: 0;
			inline-size: 100%;
			opacity: 0;
		}
	}
</style>
