// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A task or resource and its supplements in one file are one block (types.ts G1; review B4):
 * `supplement task a { start … }` sets the same `start` as `task a { start … }`, so one side's
 * change to the declaration and the other's to a supplement are checked together, by check.ts's
 * rules over the statements of all the property's bodies. When the two sides changed different
 * bodies of one property and check.ts cannot prove the changes independent (a clash, a duplicate,
 * anything it cannot key), every body of that property is one conflict, from the first to the
 * last (refine.ts, `Cx.joint`). Changes within one body are the structural rule's (blocks.ts).
 * Supplements in other files are not seen by a merge of one file (G3).
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { statementsIn } from '../tree';
import { checkBlock } from './check';
import { SIDES, type SideIx, type Tri } from './emit';
import { blockKind, type Naming } from './hints';
import type { Rng } from './out';

interface Side {
	readonly text: string;
	readonly tree: Tree;
}

/** Each side's bodies (statement nodes) of each property that has a supplement on some side. */
function propertiesOf(sides: Tri<Side>, naming: Naming): Map<string, Tri<SyntaxNode[]>> {
	const key = (n: SyntaxNode, text: string): string | null => {
		const o = naming.owner(n, text);
		return o.id === null || (o.kind !== 'task' && o.kind !== 'resource')
			? null
			: `${o.kind}:${o.id}`;
	};
	const wanted = new Set<string>();
	for (const s of SIDES) {
		for (const st of statementsIn(sides[s].tree.topNode)) {
			if (st.name !== 'SupplementStatement') continue;
			const k = key(st, sides[s].text);
			if (k) wanted.add(k);
		}
	}
	const out = new Map<string, Tri<SyntaxNode[]>>();
	if (wanted.size === 0) return out;
	for (const s of SIDES) {
		const { text } = sides[s];
		const walk = (parent: SyntaxNode): void => {
			for (const st of statementsIn(parent)) {
				const kind = blockKind(st);
				if (kind !== 'task' && kind !== 'resource' && kind !== 'supplement') continue;
				const k = key(st, text);
				if (k && wanted.has(k)) {
					const tri = out.get(k) ?? ([[], [], []] as Tri<SyntaxNode[]>);
					tri[s].push(st);
					out.set(k, tri);
				}
				const body = st.getChild('Body');
				if (body) walk(body);
			}
		};
		walk(sides[s].tree.topNode);
	}
	return out;
}

/** The statements of a block's body as written, trimmed (to tell which bodies a side changed). */
function said(st: SyntaxNode, text: string): string {
	const body = st.getChild('Body');
	if (!body) return '';
	return statementsIn(body)
		.map((n) => text.slice(n.from, n.to).trim())
		.join('\n');
}

/**
 * The properties whose bodies must be one conflict (module comment): for each, every side's
 * ranges of the property's blocks (declarations and supplements) in the file.
 */
export function jointOf(sides: Tri<Side>, naming: Naming): Tri<Rng[]>[] {
	const out: Tri<Rng[]>[] = [];
	for (const blocks of propertiesOf(sides, naming).values()) {
		const changed = (s: 1 | 2): Set<number> => {
			const set = new Set<number>();
			const n = Math.max(blocks[0].length, blocks[s].length);
			for (let i = 0; i < n; i++) {
				const o = blocks[0][i];
				const x = blocks[s][i];
				if (!o || !x || said(o, sides[0].text) !== said(x, sides[s].text)) set.add(i);
			}
			return set;
		};
		const [a, b] = [changed(1), changed(2)];
		if (![...a].some((i) => [...b].some((j) => i !== j))) continue;
		const bodies = SIDES.map((s: SideIx) =>
			blocks[s].flatMap((st) => {
				const body = st.getChild('Body');
				return body ? [body] : [];
			}),
		) as unknown as Tri<SyntaxNode[]>;
		const verdict = checkBlock(SIDES.map((s) => sides[s].text) as unknown as Tri<string>, bodies);
		if (verdict !== 'whole' && verdict.holds.size === 0 && verdict.drops.size === 0) continue;
		out.push(
			SIDES.map((s) => blocks[s].map((st) => ({ from: st.from, to: st.to }))) as unknown as Tri<
				Rng[]
			>,
		);
	}
	return out;
}
