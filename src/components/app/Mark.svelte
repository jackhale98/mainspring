<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The brand mark (ADR-0009, mark note; geometry in src/lib/brand/mark.ts): three brass task arcs
	on a dial and a ruby jewel in a brass setting. The full form has a blued-steel hairspring; at
	32 px and below the small form draws the mainspring coil instead.
	With `busy` it doubles as the loader, moving as a movement does. The dial is the escapement: it
	ticks forward twelve eased steps a turn, one every half second. The small form's mainspring
	unwinds steadily in one direction; the full form's hairspring beats once a second, and each
	half-beat lets the dial tick. While it moves it stays cheap to paint (no masks or filters, which
	WebKit repaints every frame): the turning coil is lit radially so its light does not spin, and
	the jewel drops its shadow. Under reduced motion the mark holds still and pulses gently.
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
		<linearGradient id="{uid}-s" x1="0" y1="24" x2="0" y2="96" gradientUnits="userSpaceOnUse">
			<stop offset="0" class="sh" />
			<stop offset=".5" class="sm" />
			<stop offset="1" class="sl" />
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
		<filter id="{uid}-d" x="-50%" y="-50%" width="200%" height="200%">
			<feDropShadow dx="0" dy="0.8" stdDeviation="0.9" class="shadow" />
		</filter>
		<!-- While it turns, the coil is lit radially, which looks the same at every angle. -->
		<radialGradient id="{uid}-sr" cx="60" cy="60" r="36" gradientUnits="userSpaceOnUse">
			<stop offset=".15" class="sh" />
			<stop offset=".6" class="sm" />
			<stop offset="1" class="sl" />
		</radialGradient>
	</defs>
	<g class="dial">
		{#each g.arcs as d (d)}
			<path {d} fill="none" stroke="url(#{uid}-b)" stroke-width={g.arcWidth} />
		{/each}
	</g>
	{#if g.innerRing !== null}
		<circle class="inner" cx={c} cy={c} r={g.innerRing} />
	{/if}
	{#if g.coil !== null}
		<path class="coil" d={g.coil} fill={busy ? `url(#${uid}-sr)` : `url(#${uid}-s)`} />
	{/if}
	{#if g.hairspring !== null}
		<path class="hairspring" d={g.hairspring} stroke-width={g.hairspringWidth} />
	{/if}
	<g filter={busy ? undefined : `url(#${uid}-d)`}>
		<circle cx={c} cy={c} r={g.setting} fill="url(#{uid}-b)" />
		<circle cx={c} cy={c} r={g.jewel} fill="url(#{uid}-r)" />
	</g>
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
	.sh {
		stop-color: var(--color-mark-steel-hi);
	}
	.sm {
		stop-color: var(--color-mark-steel);
	}
	.sl {
		stop-color: var(--color-mark-steel-lo);
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
	.shadow {
		flood-color: #000;
		flood-opacity: 0.3;
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
	.coil,
	.hairspring {
		transform-box: view-box;
		transform-origin: 50% 50%;
	}
	/* The escapement: a tick every half second, on the hairspring's half-beats. */
	.busy .dial {
		animation: mark-tick 6s 0.25s infinite;
	}
	/* The mainspring unwinds: one steady turn every 8 s, against the coil's winding. */
	.busy .coil {
		animation: mark-unwind 8s linear infinite;
	}
	/* The balance beats: one swing a second. */
	.busy .hairspring {
		animation: mark-beat 1s cubic-bezier(0.45, 0, 0.55, 1) infinite;
	}
	@keyframes mark-tick {
		0.000% {
			transform: rotate(0deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		2.000% {
			transform: rotate(30deg);
		}
		8.333% {
			transform: rotate(30deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		10.333% {
			transform: rotate(60deg);
		}
		16.667% {
			transform: rotate(60deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		18.667% {
			transform: rotate(90deg);
		}
		25.000% {
			transform: rotate(90deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		27.000% {
			transform: rotate(120deg);
		}
		33.333% {
			transform: rotate(120deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		35.333% {
			transform: rotate(150deg);
		}
		41.667% {
			transform: rotate(150deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		43.667% {
			transform: rotate(180deg);
		}
		50.000% {
			transform: rotate(180deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		52.000% {
			transform: rotate(210deg);
		}
		58.333% {
			transform: rotate(210deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		60.333% {
			transform: rotate(240deg);
		}
		66.667% {
			transform: rotate(240deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		68.667% {
			transform: rotate(270deg);
		}
		75.000% {
			transform: rotate(270deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		77.000% {
			transform: rotate(300deg);
		}
		83.333% {
			transform: rotate(300deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		85.333% {
			transform: rotate(330deg);
		}
		91.667% {
			transform: rotate(330deg);
			animation-timing-function: cubic-bezier(0.3, 0, 0.15, 1);
		}
		93.667% {
			transform: rotate(360deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
	@keyframes mark-unwind {
		to {
			transform: rotate(-360deg);
		}
	}
	@keyframes mark-beat {
		0%,
		100% {
			transform: rotate(-40deg) scale(0.95);
		}
		50% {
			transform: rotate(40deg) scale(1.04);
		}
	}
	@keyframes mark-pulse {
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.busy .dial,
		.busy .coil,
		.busy .hairspring {
			animation: none;
		}
		.busy {
			animation: mark-pulse 1.6s ease-in-out infinite;
		}
	}
</style>
