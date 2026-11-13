// SPDX-License-Identifier: GPL-2.0-or-later
// The T19 re-review's repros of the fast path (ADR-0010, "Review history"), as cases for
// fast-path.adversarial.test.ts: the reviewer's scripts r1.mjs (macro values, split and joined
// statements, line endings, scenario duplicates), r2.mjs (scenario duplicates, extended
// attributes, nested includes and one file included under two spellings, supplements, a patch
// of four edits), r3.mjs (`period` after `start` or `end`, N1) and r4.mjs (the value forms the
// bridge accepts or refuses). Each keeps the plan, rewrites the named lines and must give a full
// run's result, by the expected path and, when it runs in full, for the expected reason.
// Plans are as the reviewer wrote them, so the line numbers match the scripts.
import type { FastEdit } from '../../src/engine/protocol';

export const P = 'plan.tjp';

export interface Edit {
	file?: string;
	line: number;
	/** The whole new line. */
	text: string;
	task: string;
	attribute: FastEdit['attribute'];
	value: string;
}

export interface Case {
	name: string;
	files: Record<string, string>;
	edits: Edit[];
	/** null: must run fast. */
	reason: RegExp | null;
	options?: { now?: string };
}

export const E = (
	line: number,
	text: string,
	task: string,
	attribute: FastEdit['attribute'],
	value: string,
	file?: string,
): Edit => ({ line, text, task, attribute, value, ...(file ? { file } : {}) });

const IN_PLACE = /not an in-place rewrite/;
const NOT_ONE = /not one statement/;
const LATER = /later statement/;
const UNKEPT = /no kept run \(the parse gave errors\)/;

// r1.mjs
const A = `project p "P" 2026-01-05 +3m
resource r "R"
resource s "S"
macro d [5d allocate s]
task t "T" {
  effort \${d}
  allocate r
}
`;
const A2 = `project p "P" 2026-01-05 +3m
resource r "R"
macro d [5d
  allocate r]
task t "T" {
  effort \${d}
}
`;
const A3 = `project p "P" 2026-01-05 +3m
resource r "R"
task u "U" { effort 2d allocate r }
macro d [5d depends u]
task t "T" {
  effort \${d}
  allocate r
}
`;
const B = `project p "P" 2026-01-05 +3m
resource r "R"
macro std [
  effort 5d
]
task a "A" {
  \${std}
  allocate r
}
`;
const B2 = `${B}supplement task a {
  \${std}
}
`;
const B3 = `project p "P" 2026-01-05 +3m
resource r "R"
macro std [
  effort 5d
  allocate r
]
task a "A" {
  \${std}
}
`;
const C = `project p "P" 2026-01-05 +3m
resource r "R"
task t "T" {
  effort
    5d
  allocate r
}
`;
const C3 = `project p "P" 2026-01-05 +3m
resource r "R"
task t "T" {
  start 2026-01-06
  effort 3d allocate r
}
`;
const C4 = `project p "P" 2026-01-05 +3m
resource r "R"
task t "T" { effort 3d
  allocate r }
`;
const D = 'project p "P" 2026-01-05 +3m\r\nresource r "R"\r\ntask t "T" {\r\n  effort 3d\r\n  allocate r\r\n}\r\n';
const D2 = 'project p "P" 2026-01-05 +3m\rresource r "R"\rtask t "T" {\r  effort 3d\r  allocate r\r}\r';
const E1 = `project p "P" 2026-01-05 +3m {
  scenario plan "Plan" { scenario late "Late" }
}
resource r "R"
task t "T" {
  effort 2d
  plan:effort 3d
  allocate r
}
task u "U" {
  late:effort 4d
  effort 2d
  allocate r
}
`;
const F1 = `project p "P" 2026-01-05 +3m {
  extend task {
    number cost "Cost"
    date deadline "Deadline" { scenariospecific }
  }
}
resource r "R"
task t "T" {
  effort 2d
  cost 100
  deadline 2026-02-01
  allocate r
}
`;

// r2.mjs
const E2 = `project p "P" 2026-01-05 +3m {
  scenario plan "Plan" { scenario late "Late" }
}
resource r "R"
task t "T" {
  start 2026-01-06
  plan:start 2026-01-08
  effort 2d
  allocate r
}
task u "U" {
  plan:priority 300
  priority 700
  effort 2d
  allocate r
}
task v "V" {
  complete 10
  late:complete 50
  effort 2d
  allocate r
}
task w "W" {
  priority 200
  plan:priority 400
  effort 1d
  allocate r
}
`;
const F2 = `project p "P" 2026-01-05 +3m {
  extend task {
    number Cost "Cost"
    date Deadline "Deadline" { scenariospecific }
  }
}
resource r "R"
task t "T" {
  effort 2d
  Cost 100
  Deadline 2026-02-01
  allocate r
}
task u "U" {
  depends t
  length 3d
  Cost 5
}
`;
const COMMON = `task w "W" {
  effort 3d
  allocate r
}
`;
const G = {
	[P]: `project p "P" 2026-01-05 +3m
resource r "R"
include "a/one.tji"
include "common.tji" { taskprefix g1 }
`,
	'a/one.tji': `task g1 "G1" {
}
task g2 "G2" {
}
include "b/two.tji"
include "../common.tji" { taskprefix g2 }
`,
	'a/b/two.tji': `supplement task g1 {
  priority 300
}
task h "H" {
  effort 2d
  allocate r
}
`,
	'common.tji': COMMON,
};
const G4 = {
	[P]: `project p "P" 2026-01-05 +3m
resource r "R"
task g1 "G1" {
}
task g2 "G2" {
}
include "common.tji" { taskprefix g1 }
include "./common.tji" { taskprefix g2 }
`,
	'common.tji': COMMON,
};
const G5 = {
	[P]: `project p "P" 2026-01-05 +3m
resource r "R"
task t "T" {
  effort 3d
  allocate r
}
include "s.tji"
`,
	's.tji': `supplement task t {
  effort 5d
}
`,
};
const H = `project p "P" 2026-01-05 +3m
resource r "R"
task t "T" {
  start 2026-01-06
  effort 3d
  allocate r
  priority 300
  complete 20
}
`;

// r3.mjs
const PERIOD = `project p "P" 2026-01-05 +3m
resource r "R"
task t "T" {
  start 2026-01-06
  period 2026-01-12 - 2026-01-30
}
task u "U" {
  end 2026-02-20
  period 2026-01-12 - 2026-01-30
}
task v "V" {
  start 2026-01-06
  effort 3d
  allocate r
}
`;
// The attr_overwrite backstop: an attribute the fast path does not rewrite, given twice.
const OVERWRITE = `project p "P" 2026-01-05 +3m
resource r "R"
task t "T" {
  maxend 2026-03-01
  effort 3d
  allocate r
  maxend 2026-03-20
}
`;

// r4.mjs: one plan, one value per case.
const VALUES = `project p "P" 2026-01-05 +6m
resource r "R"
task t "T" {
  start 2026-01-06
  effort 3d
  allocate r
  priority 500
  complete 10
}
`;
const valueCases: [number, FastEdit['attribute'], string, RegExp | null][] = [
	[5, 'effort', '0.5d', null],
	[5, 'effort', '1w', null],
	[5, 'effort', '2.5h', null],
	[5, 'effort', '30min', /effort_zero/],
	[5, 'effort', '1m', null],
	[5, 'effort', '1.25d', null],
	// Valid TaskJuggler, refused by the strict values (coverage only, ADR-0010).
	[5, 'effort', '.5d', /not a value of effort/],
	[5, 'effort', '10', /not a value of effort/],
	[4, 'start', '2026-01-06-09:30', /misaligned_date/],
	[4, 'start', '2026-01-07-10:00:00', null],
	[4, 'start', '2026-01-07-10:00-+0100', null],
	[4, 'start', '2026-01-07-10:00--0500', null],
	[4, 'start', '2026-01-07-10:00-0500', /not a value of start/],
	[4, 'start', '2026-1-7', /not a value of start/],
	[4, 'start', '2026-01-07-9:00', null],
	[7, 'priority', '1000', null],
	[7, 'priority', '0', null],
	[7, 'priority', '1', null],
	[8, 'complete', '37.5', null],
	[8, 'complete', '100', null],
	[8, 'complete', '0', null],
	[8, 'complete', '50.25', null],
];

const one = (name: string, text: string, edits: Edit[], reason: RegExp | null): Case => ({
	name,
	files: { [P]: text },
	edits,
	reason,
});

export const rereviewCases: Case[] = [
	// r1.mjs
	one('r1 A: a macro value hiding allocate (N2)', A, [E(6, '  effort 3d', 't', 'effort', '3d')], IN_PLACE),
	one('r1 A2: a macro value spanning lines (N2)', A2, [E(6, '  effort 3d', 't', 'effort', '3d')], IN_PLACE),
	one('r1 A3: a macro value hiding depends (N2)', A3, [E(6, '  effort 3d', 't', 'effort', '3d')], IN_PLACE),
	one('r1 B: a macro body line, the macro used once', B, [E(4, '  effort 2d', 'a', 'effort', '2d')], NOT_ONE),
	one('r1 B2: a macro used twice on one task', B2, [E(4, '  effort 2d', 'a', 'effort', '2d')], UNKEPT),
	one('r1 B3: a macro body with effort and allocate', B3, [E(4, '  effort 2d', 'a', 'effort', '2d')], NOT_ONE),
	one('r1 C: a split statement, the value line', C, [E(5, '    5d', 't', 'effort', '3d')], IN_PLACE),
	one('r1 C2: a split statement, the keyword line', C, [E(4, '  effort 3d', 't', 'effort', '3d')], IN_PLACE),
	one('r1 C3: two statements on one line', C3, [E(5, '  effort 4d allocate r', 't', 'effort', '4d')], IN_PLACE),
	one('r1 C4: effort on the task header line', C4, [E(3, 'task t "T" { effort 4d', 't', 'effort', '4d')], IN_PLACE),
	one('r1 D: CRLF line ends', D, [E(4, '  effort 5d\r', 't', 'effort', '5d')], null),
	one('r1 D2: CR-only line ends (one line)', D2, [E(1, D2.replace('effort 3d', 'effort 5d'), 't', 'effort', '5d')], IN_PLACE),
	one('r1 E: effort, then plan:effort', E1, [E(6, '  effort 5d', 't', 'effort', '5d')], UNKEPT),
	one('r1 E2: late:effort, then effort', E1, [E(12, '  effort 5d', 'u', 'effort', '5d')], UNKEPT),
	one('r1 F: extended attributes with lower-case names', F1, [E(9, '  effort 4d', 't', 'effort', '4d')], UNKEPT),
	// r2.mjs
	one('r2 E: start, then plan:start', E2, [E(6, '  start 2026-01-07', 't', 'start', '2026-01-07')], LATER),
	one('r2 E2: plan:priority, then priority', E2, [E(13, '  priority 100', 'u', 'priority', '100')], /overwrote an attribute/),
	one('r2 E3: complete, then late:complete', E2, [E(18, '  complete 20', 'v', 'complete', '20')], LATER),
	one('r2 E4: priority, then plan:priority', E2, [E(24, '  priority 900', 'w', 'priority', '900')], LATER),
	one('r2 F: extended attributes, an effort', F2, [E(9, '  effort 4d', 't', 'effort', '4d')], null),
	one('r2 F2: extended attributes, a length', F2, [E(16, '  length 1d', 'u', 'length', '1d')], null),
	{ name: 'r2 G: a task in a nested include', files: G, edits: [E(5, '  effort 4d', 'h', 'effort', '4d', 'a/b/two.tji')], reason: null },
	{
		name: 'r2 G2: a supplement priority on a container, in a nested include',
		files: G,
		edits: [E(2, '  priority 100', 'g1', 'priority', '100', 'a/b/two.tji')],
		reason: /inherited by children/,
	},
	{
		name: 'r2 G3: one file included as "common.tji" and "../common.tji" (N3)',
		files: G,
		edits: [E(2, '  effort 7d', 'g1.w', 'effort', '7d', 'common.tji')],
		reason: NOT_ONE,
	},
	{
		name: 'r2 G4: one file included as "common.tji" and "./common.tji" (N3)',
		files: G4,
		edits: [E(2, '  effort 7d', 'g1.w', 'effort', '7d', 'common.tji')],
		reason: NOT_ONE,
	},
	{ name: 'r2 G5: effort, then a supplement in another file', files: G5, edits: [E(4, '  effort 4d', 't', 'effort', '4d')], reason: UNKEPT },
	{ name: 'r2 G6: the supplement line', files: G5, edits: [E(2, '  effort 6d', 't', 'effort', '6d', 's.tji')], reason: UNKEPT },
	one(
		'r2 H: four edits on one task',
		H,
		[
			E(4, '  start 2026-01-08', 't', 'start', '2026-01-08'),
			E(5, '  effort 2.5d', 't', 'effort', '2.5d'),
			E(7, '  priority 1000', 't', 'priority', '1000'),
			E(8, '  complete 37.5', 't', 'complete', '37.5'),
		],
		null,
	),
	// r3.mjs (N1)
	one('r3 P1: start, then period', PERIOD, [E(4, '  start 2026-01-08', 't', 'start', '2026-01-08')], LATER),
	one('r3 P2: end, then period', PERIOD, [E(8, '  end 2026-02-18', 'u', 'end', '2026-02-18')], LATER),
	one('r3 P3: a start with no period, beside them', PERIOD, [E(12, '  start 2026-01-08', 'v', 'start', '2026-01-08')], null),
	one('N1 backstop: maxend given twice on the edited task', OVERWRITE, [E(5, '  effort 4d', 't', 'effort', '4d')], /overwrote an attribute/),
	// r4.mjs
	...valueCases.map(([line, attribute, value, reason]) =>
		one(`r4 ${attribute} ${value}`, VALUES, [E(line, `  ${attribute} ${value}`, 't', attribute, value)], reason),
	),
];
