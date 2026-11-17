<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The lanes' legend (phase-3.md 9.2, 9.4): a booked task's bar, the badge of a text-only task, the
	hatched red "over" band, the leave types of the plan (each with its own hatch, so a type is never
	told by colour alone, WCAG 1.4.1, and always by its name too) and the group's roll-up. A plain
	list: a decorative repeat of what each lane says in words (the ARIA mirror). The patterns are
	CSS gradients that match the canvas tiles (lib/lanes/lane-patterns.ts).
-->
<script lang="ts">
	import type { EngineLeaveType } from '../../engine/protocol';
	import { lanesStrings as L, leavePaintStrings } from '../../lib/strings';
	import { HATCH_OF } from '../../lib/lanes/lane-patterns';

	interface Props {
		/** The leave types the plan has, in order. */
		types: readonly EngineLeaveType[];
	}
	let { types }: Props = $props();
</script>

<ul class="legend" aria-label={L.legend.label}>
	<li><i class="sw bar"></i>{L.legend.bar}</li>
	<li><i class="sw text-only"><b>{L.badge}</b></i>{L.legend.textOnly}</li>
	<li><i class="sw over"></i>{L.legend.over}</li>
	{#each types as t (t)}
		<li><i class="sw leave {HATCH_OF[t]}"></i>{leavePaintStrings.type[t]}</li>
	{/each}
	<li><i class="sw group"></i>{L.legend.group}</li>
</ul>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		white-space: nowrap;
	}
	.sw {
		display: inline-grid;
		place-items: center;
		inline-size: 1.4rem;
		block-size: 0.8rem;
		border-radius: 3px;
		box-sizing: border-box;
	}
	.bar {
		background: var(--color-gantt-bar-bottom);
		border: 1px solid var(--color-gantt-bar-outline);
	}
	.text-only {
		border: 1px dashed var(--color-text-only);
		background: color-mix(in srgb, var(--color-text-only) 25%, transparent);
		color: var(--color-text-only);
	}
	.text-only b {
		font-size: 0.6rem;
		line-height: 1;
	}
	.over {
		background:
			repeating-linear-gradient(135deg, var(--load-over-hatch) 0 1.5px, transparent 1.5px 5px),
			var(--load-over);
	}
	.group {
		block-size: 0.45rem;
		background: var(--load-full);
	}
	.leave {
		border: 1px solid var(--color-gantt-border-strong);
		--h: var(--leave-hatch);
	}
	.leave.back {
		background: repeating-linear-gradient(45deg, var(--h) 0 1px, transparent 1px 5px);
	}
	.leave.forward {
		background: repeating-linear-gradient(135deg, var(--h) 0 1px, transparent 1px 5px);
	}
	.leave.coarse {
		background: repeating-linear-gradient(45deg, var(--h) 0 1px, transparent 1px 9px);
	}
	.leave.cross {
		background:
			repeating-linear-gradient(45deg, var(--h) 0 1px, transparent 1px 5px),
			repeating-linear-gradient(135deg, var(--h) 0 1px, transparent 1px 5px);
	}
	.leave.across {
		background: repeating-linear-gradient(0deg, var(--h) 0 1px, transparent 1px 4px);
	}
	.leave.down {
		background: repeating-linear-gradient(90deg, var(--h) 0 1px, transparent 1px 4px);
	}
	.leave.dots {
		background: radial-gradient(circle, var(--h) 0 1px, transparent 1.5px) 0 0 / 5px 5px;
	}
</style>
