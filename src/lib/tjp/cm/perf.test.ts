// SPDX-License-Identifier: GPL-2.0-or-later
// Editor keystroke timings (T13). Spec 8.4 records targets rather than enforcing them: an
// incremental reparse after one keystroke under 5 ms, and keystroke to paint with Fedora open at
// 50 ms or less (measured in the browser by T21). This types one character into a string in
// the middle of the 1,000-task plan (syn-20) and of Fedora 20 under the full `tjp()` set, in
// Node without a DOM, and prints the median of:
// - the editor transaction (CodeMirror's incremental parse, lint and indent-unit fields),
// - the workspace commit (its own incremental reparse and the include graph walk),
// - their sum, the work between a keystroke and the view update;
// - a keyword completion query and a keyword hover query right after the keystroke;
// - an id hover with an index built for the current text (first query, then warm).
// It asserts only sanity bounds, ten times the 50 ms paint target for the sum.
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { ensureSyntaxTree } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { createWorkspace, type Workspace } from '../../workspace/workspace';
import { buildIndex } from '../index/build';
import { NO_HINTS } from '../index/hints';
import { golden } from '../index/testing';
import type { SymbolIndex } from '../index/types';
import { keywordCompletionSource } from './complete';
import { hoverInfo } from './hover';
import { workspaceExtensions } from './index';
import { setTjpDiagnostics } from './lint';
import { TABLE_ONLY } from './testing';

const PAINT_TARGET_MS = 50;
const REPARSE_TARGET_MS = 5;
const SANITY = 10;
const RUNS = 25;

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] ?? NaN;
}

const PLANS = ['syn-20-scale-1000', 'upstream-fedora-20'];

describe.each(PLANS)('%s', (id) => {
	it('types a character under the full extension set', () => {
		const seed = golden(id);
		const entry = seed.snapshot().entry;
		let ws: Workspace | null = null;
		let index: SymbolIndex | null = null;
		ws = createWorkspace(
			{ entry, files: seed.texts() },
			{
				extensions: workspaceExtensions({
					docs: () => TABLE_ONLY,
					workspace: () => ws,
					index: () => index,
				}),
			},
		);
		const workspace = ws;
		const first = workspace.state(entry);
		// As after the background parse: the editor tree covers the whole file.
		ensureSyntaxTree(first, first.doc.length, 60_000);
		const text = first.doc.toString();
		const mid = text.indexOf('"', text.length >> 1) + 1;
		// Some diagnostics in the lint field, as the runner would have pushed them.
		const diags = [0, 1, 2].map((i) => ({
			file: entry,
			from: mid + i,
			to: mid + i + 1,
			severity: 'warning' as const,
			source: 'engine' as const,
			messageId: 'x',
			message: 'x',
			hint: null,
			scenario: null,
			precision: 'token' as const,
			line: 1,
			column: 1,
			revision: 1,
			stale: false,
		}));
		workspace.commit(entry, first.update(setTjpDiagnostics(first, diags)), 'typing');

		const tx: number[] = [];
		const commit: number[] = [];
		const sum: number[] = [];
		const complete: number[] = [];
		const hover: number[] = [];
		const source = keywordCompletionSource(() => TABLE_ONLY);
		for (let i = 0; i < RUNS; i++) {
			const state = workspace.state(entry);
			const at = mid + i;
			const t0 = performance.now();
			const tr = state.update({
				changes: { from: at, insert: 'x' },
				selection: { anchor: at + 1 },
				userEvent: 'input.type',
			});
			// Transaction.state is computed lazily; this runs every field update, the parse included.
			void tr.state;
			const t1 = performance.now();
			workspace.commit(entry, tr, 'typing');
			const t2 = performance.now();
			tx.push(t1 - t0);
			commit.push(t2 - t1);
			sum.push(t2 - t0);
			const now = workspace.state(entry);
			const lineStart = now.doc.lineAt(at).from;
			const t3 = performance.now();
			const r = source(new CompletionContext(now, lineStart, true)) as CompletionResult | null;
			const t4 = performance.now();
			const kwAt = now.doc.toString().indexOf('task ', at) + 1;
			hoverInfo(now, kwAt, () => TABLE_ONLY);
			const t5 = performance.now();
			complete.push(t4 - t3);
			hover.push(t5 - t4);
			void r;
		}
		// Id hover with an index built for the current text: the first query builds the index's
		// per-file hit list, later ones reuse it.
		index = buildIndex(workspace.snapshot(), NO_HINTS);
		const now = workspace.state(entry);
		const doc = now.doc.toString();
		const ref = /\b(depends|allocate)\s+!*([A-Za-z_])/g.exec(doc.slice(doc.length >> 2));
		const refAt = ref ? (doc.length >> 2) + ref.index + ref[0].length - 1 : -1;
		const idHover: number[] = [];
		let hit: ReturnType<typeof hoverInfo> = null;
		for (let i = 0; i < RUNS; i++) {
			const t0 = performance.now();
			hit = hoverInfo(now, refAt, () => TABLE_ONLY);
			idHover.push(performance.now() - t0);
		}
		// A declared id ('symbol') or one the index cannot resolve, such as a macro id ('unresolved').
		expect(['symbol', 'unresolved']).toContain(hit?.kind);
		const ms = (xs: number[]): string => median(xs.slice(3)).toFixed(2);
		const lines = first.doc.lines;
		console.info(
			`keystroke ${id} (${lines} lines): editor transaction ${ms(tx)} ms (reparse target ${REPARSE_TARGET_MS} ms), ` +
				`workspace commit ${ms(commit)} ms, total ${ms(sum)} ms (paint target ${PAINT_TARGET_MS} ms); ` +
				`completion ${ms(complete)} ms, keyword hover ${ms(hover)} ms, ` +
				`id hover with index ${(idHover[0] ?? NaN).toFixed(2)} ms first, ${ms(idHover)} ms after`,
		);
		expect(workspace.texts()[entry]).toContain('x'.repeat(RUNS));
		expect(median(sum.slice(3))).toBeLessThan(PAINT_TARGET_MS * SANITY);
		expect(median(complete.slice(3))).toBeLessThan(PAINT_TARGET_MS * SANITY);
		expect(idHover[0] ?? Infinity).toBeLessThan(PAINT_TARGET_MS * SANITY);
	});
});
