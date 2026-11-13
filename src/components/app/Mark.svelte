<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The brand mark (ADR-0009, mark note; geometry in src/lib/brand/mark.ts): three brass task arcs
	on a dial, a blued-steel hairspring and a ruby jewel. At 32 px and below it draws the small form, with the spring as a bold coil.
	With `busy` it doubles as the loader: the dial steps through twelve eased ticks a turn while the
	hairspring swings; under reduced motion it holds still and pulses gently instead.
	Decorative unless `label` is given (then it is an image with that name).
-->
<script lang="ts">
	import { VIEWBOX, markForm, markGeometry } from '../../lib/brand/mark';

	interface Props {
		size?: number;
		busy?: boolean;
		label?: string;
	}
	let { size = 28, busy = false, label }: Props = $props();

	const uid = $props.id();
	const g = $derived(markGeometry(markForm(size)));
	const c = VIEWBOX / 2;
</script>

<svg
	class="mark"
	class:busy
	width={size}
	height={size}
	viewBox="0 0 {VIEWBOX} {VIEWBOX}"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<defs>
		<linearGradient id="{uid}-b" x1="0" y1="0" x2="0" y2={VIEWBOX} gradientUnits="userSpaceOnUse">
			<stop offset="0" class="bh" />
			<stop offset=".45" class="bm" />
			<stop offset="1" class="bl" />
		</linearGradient>
		<radialGradient
			id="{uid}-r"
			cx={g.jewelLight.cx}
			cy={g.jewelLight.cy}
			r={g.jewelLight.r}
			gradientUnits="userSpaceOnUse"
		>
			<stop offset="0" class="rh" />
			<stop offset=".55" class="rm" />
			<stop offset="1" class="rl" />
		</radialGradient>
	</defs>
	<g class="dial">
		{#each g.arcs as d (d)}
			<path {d} fill="none" stroke="url(#{uid}-b)" stroke-width={g.arcWidth} />
		{/each}
		{#if g.innerRing !== null}
			<circle class="inner" cx={c} cy={c} r={g.innerRing} />
		{/if}
	</g>
	<path class="hairspring" d={g.hairspring} stroke-width={g.hairspringWidth} />
	<circle cx={c} cy={c} r={g.jewel + 1.6} fill="none" stroke="url(#{uid}-b)" stroke-width="1.4" />
	<circle cx={c} cy={c} r={g.jewel} fill="url(#{uid}-r)" />
	<ellipse
		cx={g.highlight.cx}
		cy={g.highlight.cy}
		rx={g.highlight.rx}
		ry={g.highlight.ry}
		class="glint"
		opacity=".55"
		transform="rotate(-35 {g.highlight.cx} {g.highlight.cy})"
	/>
</svg>

<style>
	.mark {
		flex: none;
		display: block;
		overflow: visible;
	}
	.bh {
		stop-color: var(--color-mark-brass-hi);
	}
	.bm {
		stop-color: var(--color-mark-brass);
	}
	.bl {
		stop-color: var(--color-mark-brass-lo);
	}
	.rh {
		stop-color: var(--color-mark-ruby-hi);
	}
	.rm {
		stop-color: var(--color-mark-ruby);
	}
	.rl {
		stop-color: var(--color-mark-ruby-lo);
	}
	.glint {
		fill: var(--color-mark-glint);
	}
	.inner {
		fill: none;
		stroke: var(--color-mark-brass);
		stroke-width: 0.6;
		opacity: 0.55;
	}
	.hairspring {
		fill: none;
		stroke: var(--color-steel);
		stroke-linecap: round;
	}
	.dial,
	.hairspring {
		transform-box: view-box;
		transform-origin: 50% 50%;
	}
	.busy .dial {
		animation: mark-step 3s infinite;
	}
	.busy .hairspring {
		animation: mark-swing 1s cubic-bezier(0.45, 0, 0.55, 1) infinite;
	}
	/* Twelve ticks a turn: each glides 30 degrees in 0.15 s, then rests until the next. */
	@keyframes mark-step {
		0% {
			transform: rotate(0deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		5% {
			transform: rotate(30deg);
		}
		8.333% {
			transform: rotate(30deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		13.333% {
			transform: rotate(60deg);
		}
		16.667% {
			transform: rotate(60deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		21.667% {
			transform: rotate(90deg);
		}
		25% {
			transform: rotate(90deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		30% {
			transform: rotate(120deg);
		}
		33.333% {
			transform: rotate(120deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		38.333% {
			transform: rotate(150deg);
		}
		41.667% {
			transform: rotate(150deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		46.667% {
			transform: rotate(180deg);
		}
		50% {
			transform: rotate(180deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		55% {
			transform: rotate(210deg);
		}
		58.333% {
			transform: rotate(210deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		63.333% {
			transform: rotate(240deg);
		}
		66.667% {
			transform: rotate(240deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		71.667% {
			transform: rotate(270deg);
		}
		75% {
			transform: rotate(270deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		80% {
			transform: rotate(300deg);
		}
		83.333% {
			transform: rotate(300deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		88.333% {
			transform: rotate(330deg);
		}
		91.667% {
			transform: rotate(330deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		96.667%,
		100% {
			transform: rotate(360deg);
		}
	}
	@keyframes mark-swing {
		0%,
		100% {
			transform: rotate(-36deg);
		}
		50% {
			transform: rotate(36deg);
		}
	}
	@keyframes mark-pulse {
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.busy .dial,
		.busy .hairspring {
			animation: none;
		}
		.busy {
			animation: mark-pulse 1.6s ease-in-out infinite;
		}
	}
</style>
