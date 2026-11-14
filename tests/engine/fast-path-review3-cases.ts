// SPDX-License-Identifier: GPL-2.0-or-later
// The third T19 review's repros of the fast path (ADR-0010, "Review history", round 3), as cases
// for fast-path.adversarial.test.ts: the reviewer's purge probes b4.mjs, b5.mjs and b6.mjs, and
// two plans its purge generator (gen2.mjs, seed 12) found. A `purge <attribute>` after a
// rewritten statement resets the attribute in a full parse (TjpSyntaxRules.rb rule_purge,
// AttributeBase#reset), which a fast rewrite of the kept copy would set again (D1), so any later
// purge on the task must send the rewrite to a full run. A purge before it is harmless. Plans
// are as the reviewer wrote them; the edited line is found by a marker in it.
import { E, P, type Case } from './fast-path-review-cases';
import type { FastEdit } from '../../src/engine/protocol';

const LATER_PURGE = /a later purge on that task/;
const H4 = 'project p "P" 2026-01-05 +4m\nresource r "R"\nresource s "S"\n';
const HS = 'project p "P" 2026-01-05 +4m {\n  scenario plan "Plan" { scenario late "Late" }\n}\nresource r "R"\nresource s "S"\n';
const H5 = 'project p "P" 2026-01-05 +4m\nresource r "R"\n';
const HS6 = 'project p "P" 2026-01-05 +4m {\n  scenario plan "Plan" { scenario late "Late" }\n}\nresource r "R"\n';

/** A case whose edited line is the first one holding `marker`, rewritten to `text`. */
function at(
	name: string,
	plan: string,
	marker: string,
	text: string,
	task: string,
	attribute: FastEdit['attribute'],
	value: string,
	reason: RegExp | null,
): Case {
	const line = plan.split('\n').findIndex((l) => l.includes(marker)) + 1;
	if (line === 0) throw new Error(`${name}: no line with ${marker}`);
	return { name, files: { [P]: plan }, edits: [E(line, text, task, attribute, value)], reason };
}

// gen2.mjs, seed 12: the first two plans it found.
const GEN12_0 = `project p "P" 2026-01-05 +4m {
  now 2026-01-12
  scenario plan "Plan" { scenario late "Late" }
}
resource r1 "R1"
resource r2 "R2"
resource r3 "R3"
flags f
task t0 "t0" {
  priority 242
  milestone
  journalentry 2026-01-16 "j"
}
task t1 "t1" {
  flags f
  end 2026-02-22
  late:start 2026-01-07
  complete 90
  effort 3d
  allocate r2
}
task t2 "t2" {
  duration 3d
  purge late:start
  late:scheduling alap
  depends t0
  journalentry 2026-01-12 "j"
}
task t3 "t3" {
  priority 448
  purge priority
  milestone
}
supplement task t0 {
  end 2026-02-24
}
`;
const GEN12_5 = `project p "P" 2026-01-05 +4m {
}
resource r1 "R1"
resource r2 "R2"
resource r3 "R3"
flags f
task t0 "t0" {
  allocate r3
  effort 4h
  limits { dailymax 5h }
}
task t1 "t1" {
  depends t0 { gapduration 1d }
  priority 255
  duration 5d
}
task t2 "t2" {
  complete 45
  allocate r1
  purge allocate
  flags f
  effort 2d
}
supplement task t2 {
  purge effort
  allocate r2
}
`;

export const round3Cases: Case[] = [
	// b4.mjs
	at('b4: purge start after start', `${H4}task a "A" {\n  start 2026-01-07 #E\n  effort 3d\n  allocate r\n  purge start\n}\n`, '#E', '  start 2026-01-14 #E', 'a', 'start', '2026-01-14', LATER_PURGE),
	at('b4: purge effort, then length (the parse fails)', `${H4}task a "A" {\n  effort 3d #E\n  allocate r\n  purge effort\n  length 2d\n}\n`, '#E', '  effort 6d #E', 'a', 'effort', '6d', /no kept run \(the parse gave errors\)/),
	at('b4: purge effort after effort', `${H4}task a "A" {\n  effort 3d #E\n  allocate r\n  purge effort\n}\n`, '#E', '  effort 6d #E', 'a', 'effort', '6d', LATER_PURGE),
	at('b4: purge priority after priority', `${H4}task a "A" {\n  effort 3d\n  allocate r\n  priority 900 #E\n  purge priority\n}\ntask b "B" {\n  effort 3d\n  allocate r\n  priority 600\n}\n`, '#E', '  priority 100 #E', 'a', 'priority', '100', LATER_PURGE),
	at('b4: purge complete after complete', `${H4}task a "A" {\n  effort 3d\n  allocate r\n  complete 30 #E\n  purge complete\n}\n`, '#E', '  complete 80 #E', 'a', 'complete', '80', LATER_PURGE),
	at('b4: purge late:start after start', `${HS}task a "A" {\n  start 2026-01-07 #E\n  effort 3d\n  allocate r\n  purge late:start\n}\n`, '#E', '  start 2026-01-14 #E', 'a', 'start', '2026-01-14', LATER_PURGE),
	at('b4: purge late:effort after effort', `${HS}task a "A" {\n  effort 3d #E\n  allocate r\n  purge late:effort\n}\n`, '#E', '  effort 6d #E', 'a', 'effort', '6d', LATER_PURGE),
	at('b4: purge end after end', `${H4}task a "A" {\n  end 2026-03-02 #E\n  length 3d\n  purge end\n}\n`, '#E', '  end 2026-02-20 #E', 'a', 'end', '2026-02-20', LATER_PURGE),
	at('b4: purge start in a later supplement', `${H4}task a "A" {\n  start 2026-01-07 #E\n  effort 3d\n  allocate r\n}\nsupplement task a {\n  purge start\n}\n`, '#E', '  start 2026-01-14 #E', 'a', 'start', '2026-01-14', LATER_PURGE),
	// b5.mjs
	at('b5: purge priority after priority, observable in the order', `${H5}task a "A" {\n  effort 3d\n  allocate r\n  priority 900 #E\n  purge priority\n}\ntask b "B" {\n  effort 3d\n  allocate r\n  priority 300\n}\n`, '#E', '  priority 100 #E', 'a', 'priority', '100', LATER_PURGE),
	at('b5: purge before start (harmless)', `${H5}task a "A" {\n  purge start\n  start 2026-01-07 #E\n  effort 3d\n  allocate r\n}\n`, '#E', '  start 2026-01-14 #E', 'a', 'start', '2026-01-14', null),
	at('b5: the minimal repro, start then purge start', 'project p "P" 2026-01-05 +1m\ntask a "A" {\n  start 2026-01-07\n  purge start\n}\ntask b "B" { start 2026-01-06 }\n', 'start 2026-01-07', '  start 2026-01-08', 'a', 'start', '2026-01-08', LATER_PURGE),
	// b6.mjs
	at('b6: purge forward after start', `${H5}task z "Z" { effort 2d allocate r }\ntask a "A" {\n  start 2026-01-07 #E\n  depends z\n  effort 3d\n  allocate r\n  purge forward\n}\n`, '#E', '  start 2026-01-14 #E', 'a', 'start', '2026-01-14', LATER_PURGE),
	at('b6: purge milestone after effort', `${H5}task a "A" {\n  effort 3d #E\n  allocate r\n  purge milestone\n}\n`, '#E', '  effort 6d #E', 'a', 'effort', '6d', LATER_PURGE),
	at('b6: purge length after effort', `${H5}task a "A" {\n  effort 3d #E\n  allocate r\n  purge length\n}\n`, '#E', '  effort 6d #E', 'a', 'effort', '6d', LATER_PURGE),
	// `purge late:x` leaves the parser in the late scenario, so the unprefixed line after it is a
	// late statement (TjpSyntaxRules.rb:3714 sets the index only without a scenario).
	at('b6: purge late:allocate, then an unprefixed priority (read as late)', `${HS6}task a "A" {\n  effort 3d\n  allocate r\n  purge late:allocate\n  priority 300 #E\n}\n`, '#E', '  priority 800 #E', 'a', 'priority', '800', /not one statement/),
	at('b6: purge of an unrelated list attribute before the line', `${H5}task a "A" {\n  effort 3d\n  allocate r\n  purge allocate\n  allocate r\n  complete 20 #E\n}\n`, '#E', '  complete 60 #E', 'a', 'complete', '60', null),
	// gen2.mjs, seed 12
	at('gen2 seed 12 plan 0: priority, then purge priority', GEN12_0, 'priority 448', '  priority 702', 't3', 'priority', '702', LATER_PURGE),
	at('gen2 seed 12 plan 5: effort, then purge effort in a supplement', GEN12_5, 'effort 2d', '  effort 4h', 't2', 'effort', '4h', LATER_PURGE),
];
