// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What a heatmap cell says (phase-3.md 9.3, 10, 18.2, 18.3): the face drawn in it, its accessible
 * name, and the details behind it (booked, available and effective effort, the band and why, the
 * tasks). Pure functions of the load model and the labels of its axis; every sentence is from the
 * strings file. Hours are booked time, not weighted by efficiency (18.2): the details show the
 * effective effort (booked x efficiency) beside them.
 *
 * A cell names its band in words, never by colour alone (WCAG 1.4.1), and an over cell says why
 * (`overCauses`: booked above available, held or unmet work, or the threshold).
 */
import type { ResourceId, TaskId } from '../tjp/index';
import { workloadStrings as W } from '../strings';
import { overCauses, percentOf, type OverCause } from './bands';
import type { AxisLabels } from './heat-labels';
import type { HeatUnit } from './heat-prefs';
import { minutesIn } from './intervals';
import { rowMembers } from './load';
import type { Availability, Band, CellTask, LoadModel, Thresholds } from './types';

/** Minutes as hours without a trailing zero: 2280 is "38", 2265 is "37.75". */
export function hoursNumber(minutes: number): string {
	const h = Math.round((minutes / 60) * 100) / 100;
	return String(h);
}

/** Everything about one cell that is a number or a name (no sentences). */
export interface CellInfo {
	readonly row: number;
	readonly col: number;
	readonly who: string;
	readonly period: string;
	readonly booked: number;
	readonly available: number;
	readonly leave: number;
	readonly held: number;
	readonly unmet: number;
	readonly band: Band;
	/** Booked as a percentage of available, or null with no available time. */
	readonly percent: number | null;
	readonly causes: readonly OverCause[];
	/** Tasks held for, and tasks running without, the person (counts of tasks, not minutes). */
	readonly waits: number;
	readonly without: number;
}

export function cellInfo(
	model: LoadModel,
	labels: AxisLabels,
	row: number,
	col: number,
	t: Thresholds,
): CellInfo {
	const r = model.rows[row];
	const booked = model.booked[row]?.[col] ?? 0;
	const available = model.available[row]?.[col] ?? 0;
	const leave = model.leave[row]?.[col] ?? 0;
	const held = model.held[row]?.[col] ?? 0;
	const unmet = model.unmet[row]?.[col] ?? 0;
	const minutes = { booked, available, held, unmet };
	let waits = 0;
	let without = 0;
	if (held > 0 || unmet > 0) {
		for (const c of model.cellTasks(row, col)) {
			if (c.kind === 'held') waits++;
			else if (c.kind === 'unmet') without++;
		}
	}
	return {
		row,
		col,
		who: r?.name ?? '',
		period: labels.period[col] ?? '',
		booked,
		available,
		leave,
		held,
		unmet,
		band: model.band(row, col, t),
		percent: percentOf(booked, available),
		causes: overCauses(minutes, t),
		waits,
		without,
	};
}

/** The text drawn in a cell: "38h", "95%", or a dash where there is no working time. */
export function cellFace(i: Pick<CellInfo, 'booked' | 'available' | 'percent' | 'band'>, unit: HeatUnit) {
	if (i.band === 'off') return W.off;
	if (unit === 'percent') return W.percent(Math.round(i.percent ?? 0));
	return W.hours(hoursNumber(i.booked));
}

const pct = (i: CellInfo): number => Math.round(i.percent ?? 0);

/** The sentence for each clause that makes a cell over (the cell's "why", 5.4). */
export function overReasons(i: CellInfo, t: Thresholds): string[] {
	const out: string[] = [];
	for (const c of i.causes) {
		if (c === 'booked') out.push(W.details.why.booked);
		else if (c === 'threshold') out.push(W.details.why.threshold(pct(i), t.overAbove));
		else if (c === 'held') out.push(W.details.why.held(i.waits, i.who));
		else out.push(W.details.why.unmet(i.without, i.who));
	}
	return out;
}

/** The cell's accessible name: "Dev 1, week of 9 March: 38 of 40 hours, full". */
export function cellName(i: CellInfo, unit: HeatUnit, t: Thresholds): string {
	const tail: string[] = [];
	if (i.leave > 0) tail.push(W.cell.leave(hoursNumber(i.leave)));
	if (i.waits > 0) tail.push(W.cell.waits(i.waits));
	if (i.without > 0) tail.push(W.cell.runsWithout(i.without));
	if (i.band === 'off') return [W.cell.off(i.who, i.period), ...tail].join(', ');
	const head = W.cell.load(
		i.who,
		i.period,
		hoursNumber(i.booked),
		hoursNumber(i.available),
		W.cell.band[i.band],
	);
	const parts: string[] = [];
	if (unit === 'percent') parts.push(W.cell.percent(pct(i)));
	if (i.causes.includes('booked')) parts.push(W.cell.overBooked);
	else if (i.causes.includes('threshold')) parts.push(W.cell.overThreshold(pct(i), t.overAbove));
	return [head, ...parts, ...tail].join(', ');
}

/** One task in the cell details. */
export interface DetailTask {
	readonly task: TaskId;
	readonly name: string;
	readonly kind: CellTask['kind'];
	readonly minutes: number;
	/** Booked minutes times the person's efficiency; null for held and unmet tasks. */
	readonly effective: number | null;
	/** A drag may start from it (the model's rule); the menu moves are offered for every task. */
	readonly movable: boolean;
}

export interface CellDetails {
	readonly info: CellInfo;
	readonly group: boolean;
	/** Booked time times efficiency, summed over the people of the row. */
	readonly effective: number;
	readonly tasks: readonly DetailTask[];
	/** Why the band is what it is: the sentences for an over cell, else one for the others. */
	readonly why: readonly string[];
}

export interface DetailsInput {
	readonly model: LoadModel;
	readonly labels: AxisLabels;
	readonly availability: Availability;
	readonly thresholds: Thresholds;
	readonly row: number;
	readonly col: number;
	readonly taskName: (id: TaskId) => string;
}

export function cellDetails(i: DetailsInput): CellDetails {
	const { model, availability, row, col } = i;
	const info = cellInfo(model, i.labels, row, col, i.thresholds);
	const from = model.axis.bounds[col] as number;
	const to = model.axis.bounds[col + 1] as number;
	const members: readonly ResourceId[] = rowMembers(model, row);
	let effective = 0;
	const effectiveBy = new Map<TaskId, number>();
	for (const id of members) {
		const p = availability.people.get(id);
		if (!p) continue;
		effective += minutesIn(p.booked, from, to) * p.efficiency;
		for (const t of p.tasks) {
			const n = minutesIn(t.intervals, from, to);
			if (n > 0) effectiveBy.set(t.task, (effectiveBy.get(t.task) ?? 0) + n * p.efficiency);
		}
	}
	const tasks = model.cellTasks(row, col).map(
		(c): DetailTask => ({
			task: c.task,
			name: i.taskName(c.task),
			kind: c.kind,
			minutes: c.minutes,
			effective: c.kind === 'booked' ? (effectiveBy.get(c.task) ?? 0) : null,
			movable: c.movable,
		}),
	);
	const why: string[] = [];
	if (info.band === 'over') why.push(...overReasons(info, i.thresholds));
	else if (info.band === 'off') why.push(W.details.noWorkingTime);
	else if (info.band === 'spare') {
		why.push(W.details.spareWhy(Math.round(info.percent ?? 0), i.thresholds.spareBelow));
	} else why.push(W.details.fullWhy(Math.round(info.percent ?? 0)));
	return {
		info,
		group: model.rows[row]?.group ?? false,
		effective: Math.round(effective),
		tasks,
		why,
	};
}
