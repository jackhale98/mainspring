<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The working-hours editor (phase-3.md 9.6, 7.1 W8), shared by a person's details and the project
	sheet: for each weekday, "off" or one or more ranges of times. Every change is the hours of one
	weekday sent as `setWorkingHours` through the edit dispatcher (lib/resources/hours.ts), so it is
	one text patch (the edit API rewrites the statement for that day or adds one) and one undo step.

	The hours shown are what the text says, with each group's and the project's already applied
	(`weekOf`). A person who writes no hours of their own says "Same as the project until changed
	here". Hours written with a macro, or in a form the editor cannot read, are not editable: the
	editor is off, says why and offers "Show in text".

	Times are text fields (mono) that commit on Enter or blur, as every field of the inspector: 9:00,
	17:30, 24:00 for the end of the day. A time TaskJuggler would not read, or a range that does not
	end after it starts, shows its sentence under the day and nothing is sent. The "Off" box and the
	"Add hours" button are 44 px on a touch screen.
-->
<script lang="ts">
	import { changeDay, parseTime, timeText, type WeekReading } from '../../lib/resources/hours';
	import { inspectorStrings as S } from '../../lib/strings';
	import { hoursStrings as H } from '../../lib/strings-resources';
	import type { Scope } from '../../lib/tjp/edit/types';
	import type { Weekday } from '../../lib/tjp/values';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';

	interface Props {
		scope: Scope;
		/** Who the hours are for, in the toasts: the person's name, or the plan's. */
		who: string;
		reading: WeekReading;
		/** Where the hours start from when the scope writes none: a group's name, or null for the project. */
		from?: string | null;
	}
	let { scope, who, reading, from = null }: Props = $props();
	const { actions, showInText } = getInspector();
	const uid = $props.id();

	/** The weekday whose last attempt was not hours, and why. */
	let problem = $state<{ day: Weekday; text: string } | null>(null);

	async function send(
		day: Weekday,
		ranges: ReadonlyArray<readonly [number, number]>,
	): Promise<boolean> {
		const c = changeDay(scope, who, day, ranges);
		if (c.status === 'invalid') {
			problem = { day, text: H.invalid[c.reason] };
			return false;
		}
		problem = null;
		return (await actions.edit({ intent: c.intent, label: c.label })).status === 'applied';
	}

	type Range = readonly [number, number];
	const copy = (r: readonly Range[]): Array<[number, number]> => r.map(([a, b]) => [a, b]);

	async function edit(
		day: Weekday,
		ranges: readonly Range[],
		i: number,
		end: 0 | 1,
		typed: string,
	): Promise<boolean> {
		const t = parseTime(typed);
		if (t === null) {
			problem = { day, text: H.invalid.time };
			return false;
		}
		const next = copy(ranges);
		const r = next[i];
		if (!r) return false;
		r[end] = t;
		return send(day, next);
	}

	const addRange = (day: Weekday, ranges: readonly Range[]): Promise<boolean> => {
		const last = ranges.at(-1);
		const start = last ? last[1] : 540;
		const stop = last ? Math.min(start + 60, 24 * 60) : 1020;
		return send(day, [...copy(ranges), [start, stop]]);
	};
	const removeRange = (day: Weekday, ranges: readonly Range[], i: number): Promise<boolean> =>
		send(
			day,
			copy(ranges).filter((_, n) => n !== i),
		);
	const toggleOff = (day: Weekday, off: boolean): Promise<boolean> =>
		send(day, off ? [] : [[540, 1020]]);
</script>

<fieldset class="hours" disabled={reading.kind === 'text-only'} data-testid="working-hours">
	<legend>{H.title}</legend>
	{#if reading.kind === 'text-only'}
		<p class="note">{S.textOnly[reading.reason]}</p>
		<button type="button" class="link" onclick={() => showInText(reading.at)}>{S.showInText}</button
		>
	{:else}
		<p class="note" id="{uid}-note">
			{#if !reading.own}{from === null ? H.fromProject : H.fromGroup(from)}{:else}{H.hint}{/if}
		</p>
		{#each reading.days as d (d.day)}
			<div class="day" data-day={d.day}>
				<span class="name">
					<span aria-hidden="true">{H.short[d.day]}</span><span class="sr-only">{H.day[d.day]}</span
					>
				</span>
				<label class="off">
					<input
						type="checkbox"
						checked={d.ranges.length === 0}
						aria-label={H.dayOff(H.day[d.day])}
						onchange={async (e) => {
							const box = e.currentTarget;
							const applied = await toggleOff(d.day, box.checked);
							if (!applied) box.checked = d.ranges.length === 0;
						}}
					/>
					<span>{H.off}</span>
				</label>
				<div class="ranges">
					{#each d.ranges as r, i (i)}
						<div class="range">
							<CommitInput
								id="{uid}-{d.day}-{i}-from"
								value={timeText(r[0])}
								mono
								label={H.start(H.day[d.day], i + 1)}
								oncommit={(t) => edit(d.day, d.ranges, i, 0, t)}
							/>
							<span aria-hidden="true">–</span>
							<CommitInput
								id="{uid}-{d.day}-{i}-to"
								value={timeText(r[1])}
								mono
								label={H.end(H.day[d.day], i + 1)}
								oncommit={(t) => edit(d.day, d.ranges, i, 1, t)}
							/>
							{#if d.ranges.length > 1}
								<button
									type="button"
									class="icon"
									aria-label={H.removeRange(H.day[d.day], i + 1)}
									onclick={() => removeRange(d.day, d.ranges, i)}>×</button
								>
							{/if}
						</div>
					{/each}
					{#if d.ranges.length > 0 && (d.ranges.at(-1)?.[1] ?? 0) < 24 * 60}
						<button
							type="button"
							class="icon add"
							aria-label={H.addRange(H.day[d.day])}
							onclick={() => addRange(d.day, d.ranges)}>+</button
						>
					{/if}
				</div>
				{#if problem?.day === d.day}
					<p class="problem" role="alert">{problem.text}</p>
				{/if}
			</div>
		{/each}
	{/if}
</fieldset>

<style>
	.hours {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-inline-size: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		padding: 0;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.note {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.day {
		display: grid;
		grid-template-columns: 2.5rem auto 1fr;
		align-items: center;
		gap: var(--space-2);
		padding-block: var(--space-1);
		border-block-start: 1px solid var(--color-border);
	}
	.name {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.off {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-block-size: var(--size-control);
		/* The label is the checkbox's target: 44 px across as well as down (phase-3 10). */
		min-inline-size: var(--size-control);
		font-size: var(--text-sm);
	}
	.off input {
		inline-size: 1.1rem;
		block-size: 1.1rem;
		margin: 0;
	}
	.off input:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ranges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		min-inline-size: 0;
	}
	.range {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		inline-size: 11.5rem;
		max-inline-size: 100%;
	}
	.icon {
		flex: none;
		inline-size: var(--size-control);
		block-size: var(--size-control);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
	}
	.icon:hover {
		background: var(--color-row-hover);
	}
	.icon:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.problem {
		grid-column: 1 / -1;
		margin: 0;
		color: var(--color-danger, var(--color-text));
		font-size: var(--text-xs);
	}
	.link {
		align-self: start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-link, var(--color-focus));
		font: inherit;
		font-size: var(--text-sm);
		text-decoration: underline;
		cursor: pointer;
	}
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
