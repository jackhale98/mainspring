// SPDX-License-Identifier: GPL-2.0-or-later
// renameTask (7.1): rewrites the name string only, in its own quote style. Names with `${`, `$(` or a
// line break are refused (`unsafe-text`), and a templated name is text-only. With `id` (polish item
// 15) it also rewrites the id token of a leaf, when nothing could name the task by it: the header
// (`task id "name"`) is then the region, and the task and its own dependency items take the new id.
// Most corpus tasks are named by something, so most of these are refused; the applied ones are the
// cases that count.
import { slugId } from '../../../src/lib/tjp/values';
import type { Facts, Sem } from '../gen/facts';
import { rg } from '../gen/facts';
import type { Family } from './types';
import { isLeaf, task } from './util';

/** The full id `renameTask` with `id` gives the task, or null when it keeps its id. */
function nextId(intent: { task: string; id?: string }): string | null {
	if (intent.id === undefined) return null;
	const dot = intent.task.lastIndexOf('.');
	const next = dot < 0 ? intent.id : `${intent.task.slice(0, dot)}.${intent.id}`;
	return next === intent.task ? null : next;
}

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
	draw(_type, f, _sem, rng, aim) {
		const templated = f.tasks.filter((t) => t.nameMacro);
		if (aim && templated.length === 0) return null;
		if (templated.length > 0 && (aim || rng.chance(0.15))) {
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
		const name = rng.pick(NAMES);
		if (isLeaf(t) && rng.chance(0.35)) {
			return { intent: { type: 'renameTask', task: t.id, name, id: slugId(name) } };
		}
		return { intent: { type: 'renameTask', task: t.id, name } };
	},
	region(intent, f: Facts) {
		if (intent.type !== 'renameTask') return [];
		const t = task(f, intent.task);
		const at = t.nameAt;
		if (!at) return [];
		return nextId(intent) === null
			? [rg(at.file, at.from, at.to)]
			: [rg(at.file, t.block.from, at.to)];
	},
	expect(sem, _f, intent): Sem {
		const out = structuredClone(sem);
		if (intent.type === 'renameTask') {
			const t = out.tasks.find((x) => x.id === intent.task);
			if (t) t.name = intent.name;
			const next = nextId(intent);
			if (t && next !== null) {
				t.id = next;
				const end = (x: string): string => (x === intent.task ? next : x);
				out.deps = out.deps.map((d) => {
					const [pair = '', ...rest] = d.split('|');
					const [succ = '', pred = ''] = pair.split('<-');
					return [`${end(succ)}<-${end(pred)}`, ...rest].join('|');
				});
			}
		}
		return out;
	},
};
