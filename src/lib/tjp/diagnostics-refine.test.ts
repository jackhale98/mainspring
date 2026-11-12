// SPDX-License-Identifier: GPL-2.0-or-later
// Refinement rules per message id (phase-1.md 6.6 step 2). Each case is a message the wasm
// engine gave for the plan (recorded with engine/golden/run-wasm.mjs `bootNodeEngine`).
import { describe, expect, it } from 'vitest';
import type { EngineMessage } from '../../engine/protocol';
import { engineDiagnostics } from './diagnostics';
import { buildIndex } from './index';
import { inline } from './index/testing';

const HEAD = 'project p "P" 2026-01-05 +3m { now 2026-01-05 }\nresource r "R"\n';

interface Case {
	plan: string;
	id: string;
	line: number;
	text: string;
	scenario?: string;
	/** The text the range must cover, its precision and its line. */
	want: [string, 'token' | 'statement' | 'line', number];
}

const CASES: Record<string, Case> = {
	'unknown dependency, reported at the header': {
		plan: 'task a "A" {\n  effort 2d\n  allocate r\n  depends nope\n}\n',
		id: 'task_depend_unknown',
		line: 3,
		text: 'Task a has unknown depends nope',
		want: ['nope', 'token', 6],
	},
	'unknown resource in allocate': {
		plan: 'task a "A" {\n  effort 2d\n  allocate zed\n}\n',
		id: 'resource_id_expected',
		line: 5,
		text: 'zed is not a defined resource.',
		want: ['zed', 'token', 5],
	},
	'unknown resource in responsible, reported at the header': {
		plan: 'task a "A" {\n  effort 2d\n  allocate r\n  responsible bob\n}\n',
		id: 'resource_id_expected',
		line: 3,
		text: 'bob is not a defined resource.',
		want: ['bob', 'token', 6],
	},
	'duplicate task id': {
		plan: 'task a "A" {\n  effort 2d\n  allocate r\n}\ntask a "B" { effort 1d allocate r }\n',
		id: 'task_exists',
		line: 7,
		text: 'Task a has already been defined.',
		want: ['a', 'token', 7],
	},
	'effort without allocations': {
		plan: 'task a "A" {\n  effort 2d\n}\n',
		id: 'effort_no_allocations',
		line: 3,
		text: 'Task a has an effort but no resource allocations.',
		want: ['effort 2d', 'statement', 4],
	},
	'error inside a macro expansion: the call': {
		plan: 'macro bad [ effort zz ]\ntask a "A" {\n  ${bad}\n  allocate r\n}\n',
		id: 'no_reduce',
		line: 5,
		text: "Unexpected token 'zz' found. Expecting one of :INTEGER, :FLOAT",
		want: ['${bad}', 'token', 5],
	},
	'macro call history: the definition': {
		plan: 'macro bad [ effort zz ]\ntask a "A" {\n  ${bad}\n  allocate r\n}\n',
		id: 'macro_stack',
		line: 3,
		text: '  ${bad}',
		want: ['bad', 'token', 3],
	},
	'misaligned date: the value': {
		plan: 'task a "A" {\n  start 2026-01-05-09:17\n  effort 2d\n  allocate r\n}\n',
		id: 'misaligned_date',
		line: 4,
		text: 'The date must be aligned to the timing resolution (60 min) of the project.',
		want: ['2026-01-05-09:17', 'token', 4],
	},
	'date out of the project: the value': {
		plan: 'task a "A" {\n  start 2027-01-05\n  effort 2d\n  allocate r\n}\n',
		id: 'date_in_range',
		line: 4,
		text: 'Date 2027-01-05-00:00-+0000 must be within the project time frame',
		want: ['2027-01-05', 'token', 4],
	},
	'bad scheduling mode': {
		plan: 'task a "A" {\n  scheduling foo\n  effort 2d\n  allocate r\n}\n',
		id: 'no_reduce',
		line: 4,
		text: "Unexpected token 'foo' found. Expecting one of 'alap', 'asap'",
		want: ['foo', 'token', 4],
	},
	'undeclared flag': {
		plan: 'task a "A" {\n  flags nope\n  effort 2d\n  allocate r\n}\n',
		id: 'undecl_flag',
		line: 4,
		text: "Undeclared flag 'nope'",
		want: ['nope', 'token', 4],
	},
	'container attribute': {
		plan: 'task a "A" {\n  task b "B" { effort 1d allocate r }\n  depends !b\n}\n',
		id: 'container_attribute',
		line: 5,
		text: 'The attribute depends may not be used for this property after sub properties have been added.',
		want: ['depends !b', 'statement', 5],
	},
	'unterminated string: its first line': {
		plan: 'task a "A {\n  effort 2d\n}\n',
		id: 'runaway_token',
		line: 3,
		text: 'Unterminated token starting at line plan.tjp:3:',
		want: ['"A {', 'token', 3],
	},
	'unexpected end of file': {
		plan: 'task a "A" {\n  effort 2d\n  allocate r\n\n',
		id: 'no_reduce',
		line: 7,
		text: "Unexpected token '<END>' found. Expecting '}'",
		want: ['', 'token', 5],
	},
	'maximum end, for the scenario of the message': {
		plan: 'task a "A" {\n  effort 20d\n  allocate r\n  maxend 2026-03-10\n  s2:maxend 2026-01-10\n}\n',
		id: 'maxend',
		line: 3,
		scenario: 's2',
		text: 'The end time (2026-01-30-17:00-+0000) of task a is too late. Must be before 2026-01-10-00:00-+0000.',
		want: ['s2:maxend 2026-01-10', 'statement', 7],
	},
	'maximum end inherited: the header': {
		plan: 'task p "P" {\n  maxend 2026-01-10\n  task a "A" {\n    effort 20d\n    allocate r\n  }\n}\n',
		id: 'maxend',
		line: 5,
		text: 'The end time (2026-01-30-17:00-+0000) of task p.a is too late. Must be before 2026-01-10-00:00-+0000.',
		want: ['task a "A"', 'statement', 5],
	},
	'unknown supplement target': {
		plan: 'task a "A" { effort 1d allocate r }\nsupplement task zz { note "x" }\n',
		id: 'unknown_task',
		line: 4,
		text: 'Unknown task zz',
		want: ['zz', 'token', 4],
	},
	'too many bangs': {
		plan: 'task a "A" {\n  effort 2d\n  allocate r\n  depends !!!x\n}\n',
		id: 'too_many_bangs',
		line: 6,
		text: "Too many '!' for relative task in this context.",
		want: ['depends !!!x', 'statement', 6],
	},
	'overwritten attribute, reported at the next line': {
		plan: 'task a "A" {\n  effort 2d\n  allocate r\n  priority 3\n  priority 4\n}\n',
		id: 'attr_overwrite',
		line: 8,
		text: 'Overwriting a previously provided value for attribute priority',
		want: ['priority 4', 'statement', 7],
	},
	'redefined macro, reported after it': {
		plan: 'macro m [ a ]\nmacro m [ b ]\n\ntask a "A" { effort 1d allocate r }\n',
		id: 'marco_redefinition',
		line: 5,
		text: 'Redefining macro m',
		want: ['m', 'token', 4],
	},
	'missing include file': {
		plan: 'include "missing.tji"\n',
		id: 'bad_include',
		line: 3,
		text: 'Cannot open include file missing.tji',
		want: ['"missing.tji"', 'token', 3],
	},
	'unknown id: the line without its comment': {
		plan: 'task a "A" {\n  effort 2d # two days\n  allocate r\n}\n',
		id: 'something_new',
		line: 4,
		text: 'Something about this line',
		want: ['effort 2d', 'line', 4],
	},
};

function diagnose(c: Case, opts: { index: boolean; head?: string } = { index: true }) {
	const text = (opts.head ?? HEAD) + c.plan;
	const s = inline({ 'plan.tjp': text }).snapshot();
	const m: EngineMessage = {
		level: 'error',
		id: c.id,
		text: c.text,
		file: 'plan.tjp',
		line: c.line,
		column: null,
		scenario: c.scenario ?? null,
	};
	const result = {
		revision: 1,
		ok: false,
		project: null,
		tasks: [],
		resources: [],
		bookings: [],
		messages: [m],
		timings: { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 },
	};
	const [d] = engineDiagnostics(result, s, opts.index ? buildIndex(s) : null);
	if (!d) throw new Error('no diagnostic');
	return { d, text: text.slice(d.from, d.to) };
}

describe('refinement rules', () => {
	for (const [name, c] of Object.entries(CASES)) {
		it(name, () => {
			const { d, text } = diagnose(c);
			expect([text, d.precision, d.line]).toEqual(c.want);
		});
	}

	it('finds the same ranges without an index', () => {
		for (const [name, c] of Object.entries(CASES)) {
			const { d, text } = diagnose(c, { index: false });
			// Without the project frame the range check cannot run: the statement is the range.
			const want =
				c.id === 'date_in_range' ? [`start ${c.want[0]}`, 'statement', c.want[2]] : c.want;
			expect([name, text, d.precision, d.line]).toEqual([name, ...want]);
		}
	});

	it('reads engine lines with lone \\r and \\r\\n line breaks', () => {
		const plan = 'task a "A" {\r  effort 2d\r  colour 3\r}\n';
		const c: Case = {
			plan,
			id: 'no_reduce',
			line: 5,
			text: "Unexpected token 'colour' found. Expecting '}'",
			want: ['colour', 'token', 5],
		};
		expect(diagnose(c).text).toBe('colour');
		const crlf = HEAD.replace(/\n/g, '\r\n');
		const d = diagnose({ ...c, plan: plan.replace(/\r/g, '\r\n') }, { index: true, head: crlf });
		expect([d.text, d.d.line, d.d.column]).toEqual(['colour', 5, 3]);
	});
});
