// SPDX-License-Identifier: GPL-2.0-or-later
// declareFlag (7.1): appends to the last global `flags` declaration read before the first task, else
// inserts one before the first task; declaring a flag that exists is a no-op.
import { declareFlagZone, type Sem } from '../gen/facts';
import type { Family } from './types';

const NEW = ['wip', 'done', 'extra', 'review', 'frozen', 'spare'];

export const flagsFamily: Family = {
	name: 'flags',
	types: ['declareFlag'],
	draw(_type, _f, sem, rng) {
		const fresh = NEW.filter((x) => !sem.flags.includes(x));
		const flag = sem.flags.length > 0 && rng.chance(0.15) ? rng.pick(sem.flags) : rng.pick(fresh);
		return { intent: { type: 'declareFlag', flag } };
	},
	region: (_intent, f) => declareFlagZone(f),
	expect(sem, _f, intent): Sem {
		const out = structuredClone(sem);
		if (intent.type === 'declareFlag') out.flags = [...new Set([...out.flags, intent.flag])].sort();
		return out;
	},
};
