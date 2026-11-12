// SPDX-License-Identifier: GPL-2.0-or-later
// renameTask (7.1): rewrites the name string only, in its own quote style. Names with `${`, `$(` or a
// line break are refused (`unsafe-text`), and a templated name is text-only.
import type { Facts, Sem } from '../gen/facts';
import { rg } from '../gen/facts';
import type { Family } from './types';
import { task } from './util';

const NAMES = [
	'Renamed task',
	"O'Brien's plan",
	'Say "hi"',
	'Phase 3 (final)',
	'Cafe au lait',
	'x',
];
const UNSAFE = ['cost ${total}', 'call $(NAME)', 'two\nlines'];

export const renameFamily: Family = {
	name: 'rename',
	types: ['renameTask'],
	draw(_type, f, _sem, rng) {
		const templated = f.tasks.filter((t) => t.nameMacro);
		if (templated.length > 0 && rng.chance(0.15)) {
			return {
				intent: { type: 'renameTask', task: rng.pick(templated).id, name: rng.pick(NAMES) },
				mustRefuse: ['text-only'],
			};
		}
		const plain = f.tasks.filter((x) => !x.nameMacro && x.nameAt !== null);
		if (plain.length === 0) return null;
		const t = rng.pick(plain);
		if (rng.chance(0.12))
			return {
				intent: { type: 'renameTask', task: t.id, name: rng.pick(UNSAFE) },
				mustRefuse: ['unsafe-text'],
			};
		return { intent: { type: 'renameTask', task: t.id, name: rng.pick(NAMES) } };
	},
	region(intent, f: Facts) {
		if (intent.type !== 'renameTask') return [];
		const at = task(f, intent.task).nameAt;
		return at ? [rg(at.file, at.from, at.to)] : [];
	},
	expect(sem, _f, intent): Sem {
		const out = structuredClone(sem);
		if (intent.type === 'renameTask') {
			const t = out.tasks.find((x) => x.id === intent.task);
			if (t) t.name = intent.name;
		}
		return out;
	},
};
