<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	One month of the Calendar (phase-3.md 9.5, 10): a real DOM grid, `role="grid"`, with the days as
	`gridcell` elements in 6 rows of 7 (42 cells), so every month has one height and the list can
	place the ones in view (calendar/window.ts). A day shows its number and, by what is on it:

	- the global holidays, with their name from the plan's text (`ProjectInfo.leaves` has none);
	- the selected person's leaves, by type, hatched, with a dashed edge when no text item names
	  them (a shift or a macro: "From a shift or macro. Edit as text.");
	- non-working days, tinted;
	- milestones, a diamond with the task's name; a tap on it selects the task.

	Colour and pattern never carry the meaning alone (WCAG 1.4.1): every chip and mark says what it
	is in words (the chip's text, or the day's accessible name, which lists everything on it).
	Where the month is narrow (a phone) a day shows small marks instead of chips and the details
	hold the words; the grid's own width decides (a container query), not the screen's.

	The cell with the tab stop (`tabDay`) is the only one in the tab order of the whole calendar;
	the keys and the pointer are the parent's (Calendar.svelte), which finds a day by `data-day`.
-->
<script lang="ts">
	import {
		dayChips,
		dayExtra,
		MAX_CHIPS as MAX,
		monthTitle,
		weekdayName,
	} from '../../lib/calendar/describe';
	import type { DayFacts } from '../../lib/calendar/facts';
	import {
		dateOfCell,
		weekdayOrder,
		type CalendarGrid,
		type MonthBlock,
	} from '../../lib/calendar/grid';
	import { calendarStrings as C } from '../../lib/strings';

	interface Props {
		grid: CalendarGrid;
		month: MonthBlock;
		facts: (day: number) => DayFacts;
		/** The selected days `[lo, hi]`, or null. */
		selected: readonly [number, number] | null;
		/** The day with the tab stop. */
		tabDay: number | null;
		today: number | null;
		/** Where the block sits in a list (px from the top); null: in flow. */
		top?: number | null;
		/** A milestone was tapped. */
		onmilestone: (task: string) => void;
	}
	let { grid, month, facts, selected, tabDay, today, top = null, onmilestone }: Props = $props();

	const title = $derived(monthTitle(month.year, month.month));
	const headId = $derived(`cal-month-${month.year}-${month.month}`);
	const heads = $derived(weekdayOrder(grid.weekStartsMonday));
	const rows = [0, 1, 2, 3, 4, 5];
	const cols = [0, 1, 2, 3, 4, 5, 6];
</script>

<section
	class="month"
	class:listed={top !== null}
	style:top={top === null ? null : `${top}px`}
	data-testid="cal-month"
	data-month="{month.year}-{month.month}"
>
	<h3 class="title" id={headId}>{title}</h3>
	<div class="grid" role="grid" aria-labelledby={headId} aria-multiselectable="true">
		<div class="row dow" role="row">
			{#each heads as w (w)}
				<div class="head" role="columnheader" aria-label={weekdayName(w, true)}>
					{weekdayName(w)}
				</div>
			{/each}
		</div>
		{#each rows as r (r)}
			{@const empty = !cols.some((c) => dateOfCell(month, r * 7 + c) !== null)}
			<div
				class="row"
				role={empty ? 'presentation' : 'row'}
				aria-hidden={empty ? 'true' : undefined}
			>
				{#each cols as c (c)}
					{@const date = dateOfCell(month, r * 7 + c)}
					{#if date === null}
						<div class="cell pad" role="presentation"></div>
					{:else}
						{@const i = grid.dayOfDate(month, date)}
						{#if i < 0}
							<div class="cell out" role="gridcell" aria-disabled="true">
								<span class="num">{date}</span>
								<span class="sr-only">{C.outside}</span>
							</div>
						{:else}
							{@const day = grid.days[i]}
							{@const f = facts(i)}
							{@const chips = dayChips(f)}
							{@const isSel = selected !== null && i >= selected[0] && i <= selected[1]}
							{#if day}
								<div
									class="cell"
									class:nonworking={!f.working && f.top === null}
									class:leave={f.top !== null && f.holidays.length === 0}
									class:holiday={f.holidays.length > 0}
									class:selected={isSel}
									class:today={today === i}
									role="gridcell"
									tabindex={tabDay === i ? 0 : -1}
									aria-selected={isSel}
									aria-current={today === i ? 'date' : undefined}
									data-day={i}
									data-testid="cal-day"
									data-date="{month.year}-{String(month.month).padStart(2, '0')}-{String(
										date,
									).padStart(2, '0')}"
								>
									<span class="num">{date}</span>
									<span class="chips">
										{#each chips.slice(0, MAX) as chip, k (k)}
											{#if chip.kind === 'milestone' && chip.task}
												<button
													type="button"
													class="chip milestone"
													tabindex="-1"
													data-milestone={chip.task}
													data-testid="cal-milestone"
													onclick={() => onmilestone(chip.task as string)}
												>
													<i class="diamond" aria-hidden="true"></i><span class="t"
														>{chip.text}</span
													>
												</button>
											{:else}
												<span class="chip {chip.kind}" class:textonly={chip.textOnly}>
													<span class="t">{chip.text}</span>
												</span>
											{/if}
										{/each}
										{#if chips.length > MAX}
											<span class="more">+{chips.length - MAX}</span>
										{/if}
									</span>
									<span class="sr-only">, {dayExtra(day, f)}</span>
									<span class="marks" aria-hidden="true">
										{#each chips.slice(0, 3) as chip, k (k)}
											<i class="mark {chip.kind}" class:textonly={chip.textOnly}></i>
										{/each}
									</span>
								</div>
							{/if}
						{/if}
					{/if}
				{/each}
			</div>
		{/each}
	</div>
</section>

<style>
	.month {
		container: month / inline-size;
		box-sizing: border-box;
		block-size: var(--cal-month-h);
		padding-block-end: var(--cal-gap);
		padding-inline: var(--gutter);
		position: relative;
	}
	/* In the list a block is placed by its index (window.ts). */
	.month.listed {
		position: absolute;
		inset-inline: 0;
	}
	.title {
		display: flex;
		align-items: center;
		block-size: var(--cal-title);
		margin: 0;
		color: var(--color-text);
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 400;
	}
	.grid {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--color-gantt-surface);
	}
	.row {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		block-size: var(--cal-row);
	}
	.row.dow {
		block-size: var(--cal-dow);
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface-header);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-gantt-text-muted);
		font-size: var(--text-label);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.cell {
		position: relative;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: hidden;
		padding: 2px 4px;
		border-inline-start: 1px solid var(--color-gantt-grid);
		border-block-start: 1px solid var(--color-gantt-grid);
		color: var(--color-gantt-text);
		font-size: var(--text-label);
		cursor: default;
		user-select: none;
		-webkit-user-select: none;
	}
	.row > .cell:first-child {
		border-inline-start: 0;
	}
	.row:nth-child(2) > .cell {
		border-block-start: 0;
	}
	.pad {
		background: var(--color-gantt-surface-header);
	}
	.out {
		color: var(--color-gantt-text-faint);
		background: var(--color-gantt-surface-header);
	}
	.num {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		line-height: 1.2;
	}
	.nonworking {
		background: var(--color-gantt-weekend);
		color: var(--color-gantt-text-muted);
	}
	.holiday {
		background: var(--color-gantt-holiday);
	}
	/* A person's leave: stripes, not a colour. */
	.leave {
		background-image: repeating-linear-gradient(
			135deg,
			transparent 0 6px,
			color-mix(in srgb, var(--leave-hatch) 22%, transparent) 6px 7px
		);
	}
	.cell:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: -3px;
		z-index: 1;
	}
	.cell.selected {
		background-color: var(--color-row-selected);
		box-shadow: inset 0 0 0 2px var(--color-steel);
	}
	/* Today: a ring round the number, so it is not colour alone. */
	.today .num {
		align-self: flex-start;
		padding-inline: 5px;
		border-radius: var(--radius-pill);
		background: var(--color-pill-on);
		color: var(--color-pill-on-ink);
	}
	.chips {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-inline-size: 0;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 4px;
		min-inline-size: 0;
		padding: 0 4px;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 11px;
		line-height: 15px;
	}
	.chip .t {
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip.holiday {
		border-color: var(--color-brass-deep);
		background: var(--color-brass-wash);
		color: var(--color-brass-ink);
	}
	.chip.leave {
		border-color: var(--leave-hatch);
		background: var(--color-gantt-surface);
		color: var(--color-gantt-text);
	}
	/* A leave no text item names: a dashed edge. */
	.chip.textonly,
	.mark.textonly {
		border-style: dashed;
	}
	button.chip.milestone {
		cursor: pointer;
	}
	button.chip.milestone:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 1px;
	}
	.diamond {
		flex: none;
		inline-size: 8px;
		block-size: 8px;
		transform: rotate(45deg);
		background: var(--color-gantt-milestone);
		outline: 1px solid var(--color-gantt-bar-outline);
	}
	.more {
		padding-inline: 4px;
		color: var(--color-gantt-text-muted);
		font-size: 11px;
	}
	.marks {
		display: none;
		gap: 3px;
		margin-block-start: auto;
		margin-inline: auto;
	}
	.mark {
		inline-size: 9px;
		block-size: 9px;
		border: 1px solid var(--color-gantt-bar-outline);
		box-sizing: border-box;
	}
	.mark.holiday {
		background: var(--color-brass-deep);
	}
	.mark.leave {
		background: repeating-linear-gradient(135deg, var(--leave-hatch) 0 1px, transparent 1px 3px);
		border-color: var(--leave-hatch);
	}
	.mark.milestone {
		transform: rotate(45deg) scale(0.85);
		background: var(--color-gantt-milestone);
	}
	/* A narrow month (a phone): marks, no chips. The day's name has the words. */
	@container month (max-width: 479px) {
		/* Visually hidden, not removed: the words stay in the day's name. */
		.chips {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.marks {
			display: flex;
		}
		.num {
			align-self: center;
		}
		.cell {
			align-items: center;
			padding: 2px;
			font-size: var(--text-xs);
		}
		.today .num {
			align-self: center;
		}
	}
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
