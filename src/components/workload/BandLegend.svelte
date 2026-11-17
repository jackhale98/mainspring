<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The bands of the heatmap with their swatches (phase-3.md 9.2): spare, full, over, no working
	time, and leave. Each swatch carries its cue besides colour (WCAG 1.4.1): over is hatched like
	its cells, leave is striped, and every row says its name. With `rules` each band also says when
	a cell is in it, from the thresholds (the thresholds panel); without it the row is the
	toolbar's compact legend. Decorative repeat of what the cells say in words: a plain list.
-->
<script lang="ts">
	import { workloadStrings as W } from '../../lib/strings-workload';
	import type { Band, Thresholds } from '../../lib/workload/types';

	interface Props {
		/** When given, each band says its rule. */
		rules?: Thresholds | undefined;
	}
	let { rules }: Props = $props();

	const BANDS: readonly Band[] = ['spare', 'full', 'over', 'off'];
	const rule = (b: Band, t: Thresholds): string =>
		b === 'spare'
			? W.rule.spare(t.spareBelow)
			: b === 'full'
				? W.rule.full(t.spareBelow, t.overAbove)
				: b === 'over'
					? W.rule.over(t.overAbove)
					: W.rule.off;
</script>

<ul class="legend" class:rules={rules !== undefined} aria-label={W.legend}>
	{#each BANDS as b (b)}
		<li>
			<i class="sw {b}"></i><span class="text"
				><span class="name">{W.band[b]}</span>{#if rules}<span class="rule">{rule(b, rules)}</span
					>{/if}</span
			>
		</li>
	{/each}
	<li>
		<i class="sw leave"></i><span class="text"
			><span class="name">{W.legendLeave}</span>{#if rules}<span class="rule">{W.rule.leave}</span
				>{/if}</span
		>
	</li>
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
	.rules {
		flex-direction: column;
		flex-wrap: nowrap;
		gap: var(--space-1);
	}
	.rules li {
		white-space: normal;
		align-items: flex-start;
	}
	.rules .sw {
		margin-block-start: 2px;
	}
	.name {
		font-weight: 500;
	}
	.rule {
		color: var(--color-text-muted);
	}
	.rule::before {
		content: ': ';
	}
	/* Swatches: the band, with its cue besides colour (over is hatched; leave is striped). */
	.sw {
		flex: none;
		inline-size: 14px;
		block-size: 12px;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 3px;
	}
	.sw.spare {
		background: var(--load-spare);
	}
	.sw.full {
		background: var(--load-full);
	}
	.sw.off {
		background: var(--load-off);
	}
	.sw.over {
		border-color: var(--load-over);
		background: repeating-linear-gradient(
			135deg,
			var(--load-over) 0 3px,
			color-mix(in srgb, var(--load-over), white 35%) 3px 5px
		);
	}
	.sw.leave {
		background: repeating-linear-gradient(
			45deg,
			var(--leave-hatch) 0 1px,
			var(--load-spare) 1px 4px
		);
	}
</style>
