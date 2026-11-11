// SPDX-License-Identifier: GPL-2.0-or-later
// The context tracker's frames (context.ts): which context each body opens, and the hashes that
// incremental reuse relies on. Reuse itself is covered by parser.property.test.ts.
import { describe, expect, it } from 'vitest';
import { ContextTracker } from '@lezer/lr';
import { TjpFrame, reduceFrame, shiftFrame, topFrame } from './context';
import * as T from './parser.terms.generated';
import { tjpGlobalParser } from './parser';

/** The context each `{` opens, recorded by a tracker built from the same steps. */
function bodyContexts(text: string): (string | null)[] {
	const out: (string | null)[] = [];
	const recorder = new ContextTracker<TjpFrame>({
		start: topFrame('global'),
		shift: (frame, term, _stack, input) => {
			const next = shiftFrame(frame, term, input, 0);
			if (term === T.OpenBrace || term === T.ExprOpen) out.push(next.ctx);
			return next;
		},
		reduce: (frame, term) => reduceFrame(frame, term),
		hash: (frame) => frame.hash,
	});
	tjpGlobalParser.configure({ contextTracker: recorder }).parse(text);
	return out;
}

describe('TjpFrame', () => {
	it('starts in the top context of the file', () => {
		expect(topFrame('global').ctx).toBe('');
		expect(topFrame('project').ctx).toBe('project');
		expect(topFrame('prolog').ctx).toBe('<prolog>');
		expect(topFrame('global').depth).toBe(0);
	});

	it('hashes its content, parents included', () => {
		const a = new TjpFrame('task', null, null, topFrame('global'));
		const b = new TjpFrame('task', null, null, topFrame('global'));
		const c = new TjpFrame('task', 'depends', null, topFrame('global'));
		const d = new TjpFrame('task', null, null, topFrame('project'));
		expect(a.hash).toBe(b.hash);
		expect(a.hash).not.toBe(c.hash);
		expect(a.hash).not.toBe(d.hash);
		expect(a.depth).toBe(1);
	});

	it('returns itself when nothing changes', () => {
		const f = topFrame('global');
		expect(f.with(null, null)).toBe(f);
		expect(f.with('task', null).pending).toBe('task');
	});
});

describe('body contexts', () => {
	it('follow the keyword, the supplement subject and nesting', () => {
		const text =
			'task t "T" { depends a { }, b { } allocate r { } }\n' +
			'supplement resource r { }\nsupplement task t { }\ntaskreport x "" { columns name { } }';
		expect(bodyContexts(text)).toEqual([
			'task',
			'depends',
			'depends',
			'allocate',
			'supplement.resource',
			'supplement.task',
			'taskreport',
			'columns',
		]);
	});

	it('are unknown in a date expression and in an extension attribute body', () => {
		expect(bodyContexts('task t "T" { start %{2024-01-01 + 1d} URL "u" { } }')).toEqual([
			'task',
			null,
			null,
		]);
	});
});
