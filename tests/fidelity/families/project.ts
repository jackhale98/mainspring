// SPDX-License-Identifier: GPL-2.0-or-later
// setProjectHeader, setProjectAttr, removeProjectAttr (7.1, 15.22). The header rewrite touches the name
// string and the interval tokens only; project settings are written like task attributes, at their rank
// in the project order of 7.2 (timezone, timeformat, currency, now, dailyworkinghours, weekstartsmonday,
// workinghours). `weekstartsmonday` false writes `weekstartssunday`, and true or false replaces it.
import type { ProjectAttr } from '../../../src/lib/tjp/edit/types';
import { normValue, PROJ_RANK, rg, stmtZone, type Facts, type Rg, type Sem } from '../gen/facts';
import type { Rng } from '../gen/rng';
import { insertZones } from './attr';
import type { Drawn, Family, Region } from './types';
import { dateValue, own } from './util';

const NAMES = ['Renamed project', "Q1 'plan'", 'Roadmap 2026'];
const WEEK = ['weekstartsmonday', 'weekstartssunday'];

const day = (sec: number): string => new Date(sec * 1000).toISOString().slice(0, 10);
const epoch = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 1000;

/** Values valid in any plan; a generated plan (UTC, known frame) also takes the ones that change dates. */
function valueFor(attr: ProjectAttr, f: Facts, rng: Rng): string | boolean | null {
	switch (attr) {
		case 'timezone':
			return f.frameDates ? rng.pick(['"UTC"', 'UTC']) : null;
		case 'timeformat':
			return rng.pick(['"%Y-%m-%d"', '"%d.%m.%Y"']);
		case 'currency':
			return rng.pick(['"EUR"', '"USD"']);
		case 'now':
			return dateValue(rng, f)?.replace(/^(\d{4}-\d\d-\d\d)$/, '$1-09:00') ?? null;
		case 'dailyworkinghours':
			return f.frameDates ? rng.pick(['7', '7.5', '8']) : null;
		default:
			return f.frameDates ? rng.chance(0.5) : null;
	}
}

const ATTRS: readonly ProjectAttr[] = [
	'timezone',
	'timeformat',
	'currency',
	'now',
	'dailyworkinghours',
	'weekstartsmonday',
];

export const projectFamily: Family = {
	name: 'project',
	types: ['setProjectHeader', 'setProjectAttr', 'removeProjectAttr'],
	draw(type, f, _sem, rng, aim): Drawn | null {
		if (aim) return null;
		const p = f.project;
		if (!p) return null;
		if (type === 'setProjectHeader') {
			if (rng.chance(0.1))
				return {
					intent: { type, name: rng.pick(['cost ${x}', 'two\nlines']) },
					mustRefuse: ['unsafe-text'],
				};
			if (!f.frameDates || !f.frame || rng.chance(0.4))
				return { intent: { type, name: rng.pick(NAMES) } };
			const end = day(f.frame.end + 86400 * rng.int(0, 30));
			const start = day(f.frame.start - 86400 * rng.int(0, 10));
			const dates = rng.chance(0.5) ? { start, end } : { end };
			return { intent: { type, ...(rng.chance(0.5) ? { name: rng.pick(NAMES) } : {}), ...dates } };
		}
		if (type === 'setProjectAttr') {
			const attr = rng.pick(ATTRS);
			const value = valueFor(attr, f, rng);
			return value === null ? null : { intent: { type, attr, value } };
		}
		const present = ATTRS.filter((a) =>
			(a === 'weekstartsmonday' ? WEEK : [a]).some((k) => own(p, k).length > 0),
		);
		const attr = present.length > 0 && rng.chance(0.85) ? rng.pick(present) : rng.pick(ATTRS);
		return { intent: { type: 'removeProjectAttr', attr } };
	},
	region(intent, f): Region {
		const p = f.project;
		if (!p) return [];
		if (intent.type === 'setProjectHeader') {
			const zones: Rg[] = [];
			if (intent.name !== undefined && p.nameAt) zones.push(p.nameAt);
			if ((intent.start !== undefined || intent.end !== undefined) && p.frameAt)
				zones.push(rg(p.frameAt.start.file, p.frameAt.start.from, p.frameAt.end.to));
			return zones;
		}
		if (intent.type === 'setProjectAttr') {
			const keys = intent.attr === 'weekstartsmonday' ? WEEK : [intent.attr];
			const s = own(p, ...keys);
			if (intent.attr === 'weekstartsmonday')
				return s.length > 0
					? s.flatMap((x) => stmtZone(f, x))
					: insertZones(f, p, 'weekstartsmonday', keys, PROJ_RANK);
			const last = s[s.length - 1];
			return last ? [last.range] : insertZones(f, p, intent.attr, keys, PROJ_RANK);
		}
		if (intent.type === 'removeProjectAttr') {
			return own(p, ...(intent.attr === 'weekstartsmonday' ? WEEK : [intent.attr])).flatMap((x) =>
				stmtZone(f, x),
			);
		}
		return [];
	},
	expect(sem, _f, intent): Sem {
		const out = structuredClone(sem);
		const p = out.project;
		if (!p) return out;
		if (intent.type === 'setProjectHeader') {
			if (intent.name !== undefined) p.name = intent.name;
			if (p.frame && (intent.start !== undefined || intent.end !== undefined)) {
				p.frame = [
					intent.start !== undefined ? epoch(intent.start) : p.frame[0],
					intent.end !== undefined ? epoch(intent.end) : p.frame[1],
				];
			}
		} else if (intent.type === 'setProjectAttr') {
			if (intent.attr === 'weekstartsmonday') {
				for (const k of WEEK) delete p.attrs[k];
				// `weekstartssunday` is opaque: the index does not list it.
				if (intent.value) p.attrs['weekstartsmonday'] = [''];
			} else {
				const v = normValue(String(intent.value));
				const arr = p.attrs[intent.attr] ?? [];
				p.attrs[intent.attr] = arr.length > 0 ? [...arr.slice(0, -1), v] : [v];
			}
		} else if (intent.type === 'removeProjectAttr') {
			for (const k of intent.attr === 'weekstartsmonday' ? WEEK : [intent.attr]) delete p.attrs[k];
		}
		return out;
	},
};
