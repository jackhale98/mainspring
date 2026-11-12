// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Project settings as they stand at each position in parse order (values/context.ts), for
 * `checkValue`. TaskJuggler applies these as it reads them: the project-level `timezone`
 * (TjpSyntaxRules.rb:7135, how later dates are read), `timingresolution`, `dailyworkinghours`,
 * `yearlyworkingdays` and the project `workinghours` (weekly hours). The header interval gives
 * the project frame, read before any of them (UTC, 60 min resolution). Settings of reports,
 * shifts and resources do not count.
 *
 * The tracker keeps one context per change and, for every include visit, marks (offset, context)
 * in reading order; a position's context is the one at the last mark at or before it.
 */
import type { ZoneOffsets } from '../values';
import {
	DEFAULT_CONTEXT,
	DEFAULT_WEEK,
	applyWorkingHours,
	parseInterval,
	parseValue,
	resolveInterval,
	weeklyWorkingHours,
	type WeekTable,
} from '../values';
import type { AttrSite, IndexContext } from './types';

interface Marks {
	offsets: number[];
	states: number[];
}

export class ContextTracker {
	private readonly states: IndexContext[];
	private readonly marks = new Map<number, Marks>();
	private week: WeekTable = DEFAULT_WEEK;
	private current = 0;

	constructor(zones: ZoneOffsets | undefined) {
		const base: IndexContext = { ...DEFAULT_CONTEXT, scenarios: [] };
		this.states = [zones ? { ...base, zones } : base];
	}

	get context(): IndexContext {
		return this.states[this.current] as IndexContext;
	}

	/** Records that `offset` in `visit` reads with the current context. */
	mark(visit: number, offset: number): void {
		let m = this.marks.get(visit);
		if (!m) {
			m = { offsets: [], states: [] };
			this.marks.set(visit, m);
		}
		m.offsets.push(offset);
		m.states.push(this.current);
	}

	/** Changes the context from `offset` in `visit` on. */
	change(visit: number, offset: number, over: Partial<IndexContext>): void {
		this.states.push({ ...this.context, ...over });
		this.current = this.states.length - 1;
		this.mark(visit, offset);
	}

	/** The context at `pos` in `visit` (the default before its first mark). */
	at(visit: number, pos: number): IndexContext {
		const m = this.marks.get(visit);
		if (!m) return this.states[0] as IndexContext;
		let lo = 0;
		let hi = m.offsets.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((m.offsets[mid] ?? 0) <= pos) lo = mid + 1;
			else hi = mid;
		}
		const i = lo === 0 ? null : m.states[lo - 1];
		return this.states[i ?? 0] as IndexContext;
	}

	/** The project header's interval, read in the context before it. */
	header(visit: number, offset: number, intervalText: string | null): [number, number] | null {
		if (intervalText === null) return null;
		const iv = parseInterval(intervalText);
		if (!iv.ok) return null;
		const r = resolveInterval(iv.value, this.context);
		if (!r.ok) return null;
		this.change(visit, offset, { start: r.value[0], end: r.value[1] });
		return [r.value[0], r.value[1]];
	}

	addScenario(visit: number, offset: number, id: string): void {
		this.change(visit, offset, { scenarios: [...this.context.scenarios, id] });
	}

	/** A project-level attribute; settings that change how values read update the context. */
	projectAttr(visit: number, attr: AttrSite, valueText: string | null): void {
		const end = attr.statement.to;
		// Opaque settings (`timingresolution`, `yearlyworkingdays`) count unless a macro is in them.
		if (attr.textOnly !== null && attr.textOnly.reason !== 'opaque') return;
		switch (attr.keyword) {
			case 'timezone': {
				const v = attr.parsed;
				if (v?.kind === 'string') this.change(visit, end, { zone: v.value });
				return;
			}
			case 'dailyworkinghours': {
				const v = attr.parsed;
				if (v?.kind === 'number') this.change(visit, end, { dailyWorkingHours: v.value });
				return;
			}
			case 'workinghours': {
				const v = attr.parsed;
				if (v?.kind !== 'workinghours') return;
				this.week = applyWorkingHours(this.week, v.value);
				this.change(visit, end, { weeklyWorkingHours: weeklyWorkingHours(this.week) });
				return;
			}
			case 'timingresolution':
			case 'yearlyworkingdays': {
				if (valueText === null || attr.scenario !== null) return;
				if (attr.keyword === 'timingresolution') {
					const r = parseValue('timingresolution', valueText);
					if (r.ok && r.value.kind === 'timingresolution')
						this.change(visit, end, { granularity: r.value.value * 60 });
				} else {
					const r = parseValue('number', valueText);
					if (r.ok && r.value.kind === 'number')
						this.change(visit, end, { yearlyWorkingDays: r.value.value });
				}
				return;
			}
			default:
				return;
		}
	}
}
