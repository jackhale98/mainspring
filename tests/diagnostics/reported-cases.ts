// SPDX-License-Identifier: GPL-2.0-or-later
// Plans whose engine messages TaskJuggler reports after the statement they are about
// (attr_overwrite, container_attribute), from the T9 review. `messages` are what the wasm
// engine gave for each plan (engine/golden/run-wasm.mjs); `want` is, per message, the exact text
// of the range the diagnostic must cover. Used by src/lib/tjp/diagnostics-refine.test.ts (with
// the recorded messages) and src/lib/tjp/diagnostics.engine.test.ts (with a real run).
import type { EngineMessage } from '../../src/engine/protocol';

export interface ReportedCase {
	readonly name: string;
	readonly plan: string;
	readonly messages: readonly EngineMessage[];
	readonly want: readonly string[];
}

const HEAD = 'project p "P" 2026-01-05 +3m {\n}\nresource r "R"\n';
const SCENARIOS =
	'project p "P" 2026-01-05 +3m {\n  scenario plan "Plan" {\n    scenario delayed "Delayed"\n  }\n}\nresource r "R"\n';

const msg = (
	id: string,
	line: number,
	text: string,
	level: EngineMessage['level'] = 'warning',
): EngineMessage => ({ level, id, text, file: 'plan.tjp', line, column: null, scenario: null });

const overwrite = (attr: string, line: number) =>
	msg('attr_overwrite', line, `Overwriting a previously provided value for attribute ${attr}`);

const history = (call: string, line: number): EngineMessage[] => [
	{ ...msg('macro_stack', 0, 'Macro call history:', 'info'), file: null, line: null },
	msg('macro_stack', line, `  ${call}`, 'info'),
];

export const REPORTED_CASES: readonly ReportedCase[] = [
	{
		name: 'period after period in task b, not the start of task a',
		plan: `${SCENARIOS}task a "A" {\n  start 2026-01-06\n  duration 1d\n}\ntask b "B" {\n  period 2026-01-07 - 2026-01-09\n  period 2026-01-08 - 2026-01-10\n}\n`,
		messages: [overwrite('start', 13)],
		want: ['period 2026-01-08 - 2026-01-10'],
	},
	{
		name: 'a macro call setting effort after a child task',
		plan: `${SCENARIOS}macro eff [effort 2d]\ntask t "T" {\n  effort 1d\n  task c "C" { effort 1d allocate r }\n  \${eff}\n}\n`,
		messages: [
			...history('${eff}', 7),
			msg(
				'container_attribute',
				11,
				'The attribute effort may not be used for this property after sub properties have been added.',
				'error',
			),
		],
		want: ['project p "P" 2026-01-05 +3m', 'eff', '${eff}'],
	},
	{
		name: 'priority 200, then a macro call setting priority',
		plan: `${SCENARIOS}macro prio [priority 700]\ntask a "A" {\n  priority 100\n  duration 1d\n}\ntask b "B" {\n  priority 200\n  \${prio}\n  duration 1d\n}\n`,
		messages: [...history('${prio}', 7), overwrite('priority', 14)],
		want: ['project p "P" 2026-01-05 +3m', 'prio', '${prio}'],
	},
	{
		name: 'start, then period in one task',
		plan: `${HEAD}task t "T" {\n  start 2026-01-06\n  period 2026-01-07 - 2026-01-09\n}\n`,
		messages: [overwrite('start', 6)],
		want: ['period 2026-01-07 - 2026-01-09'],
	},
	{
		name: 'chained hidetask lines',
		plan: `${HEAD.replace('resource r "R"\n', '')}flags fa, fb\ntask a "A" { duration 1d }\ntaskreport rep "rep" {\n  formats html\n  hidetask fa | fb\n  hidetask fb | fa\n  hidetask fa\n}\n`,
		messages: [overwrite('hideTask', 9), overwrite('hideTask', 10)],
		want: ['hidetask fb | fa', 'hidetask fa'],
	},
	{
		name: 'two starts on one line',
		plan: `${HEAD}task t "T" { start 2026-01-06 start 2026-01-07 }\ntask u "U" { start 2026-01-06 }\n`,
		messages: [overwrite('start', 4)],
		want: ['start 2026-01-07'],
	},
];
