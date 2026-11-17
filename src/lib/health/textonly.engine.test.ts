// SPDX-License-Identifier: GPL-2.0-or-later
// Text-only tasks are reported, and their fixes are disabled with the reason (section 12), on the
// real engine: a plan whose dates, gap, allocation and one whole task are written with macros. Each
// check still finds what the schedule shows; each fix's `disabled` is the text-only reason the
// edit API refuses its edit with (dry-run with `applyIntent`), and the fixes that only open a place
// stay enabled. Needs the built engine; skipped without it unless HEALTH_ENGINE=1.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check, ENGINE } from './health-engine-testing';
import { disabledProblem, probe } from './testing';

const REQUIRED = process.env['HEALTH_ENGINE'] === '1';

const PLAN = `macro day [2026-01-05]
macro gap [gaplength 6d]
macro who [dev]
macro made [
task made "Made" {
  effort 2d
  allocate ann
}
]
project p "P" 2026-01-05 - 2026-03-27 {
}

resource dev "Dev"
resource ann "Ann"

task kick "Kickoff" {
  milestone
}

task build "Build" {
  depends kick
  start \${day}
  priority 900
  effort 3d
  allocate dev
}

task test "Test" {
  depends build { \${gap} }
  effort 3d
  allocate ann
}

task side "Side" {
  depends kick
  length 5d
  allocate \${who}
}

\${made}

task done "Done" {
  depends test, side
  milestone
}
`;

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('text-only fixes on the engine', () => {
	it('reports macro-written tasks and disables their fixes with the reason', async () => {
		const c = await check({ 'plan.tjp': PLAN });
		expect(c.result.messages.filter((m) => m.level === 'error')).toEqual([]);
		const seen = c.report.findings.map((f) => [
			f.check,
			f.subject.kind === 'task' ? f.subject.id : f.subject.kind,
			f.fixes.map((x) => x.disabled),
		]);
		expect(seen).toEqual([
			// Declared only through `${made}`: the picker cannot write into it or name it.
			['no-predecessor', 'made', ['expanded-only']],
			['no-successor', 'made', ['expanded-only']],
			// `start ${day}`: the date is not read (null), so it is not shown; "Why here?" stays.
			['hard-constraint', 'build', ['macro-call', null]],
			// `{ ${gap} }`: both gap fixes.
			['long-gap', 'link', ['macro-call', 'macro-call']],
			// `allocate ${who}`: "Replace person…"; "Open in Workload" stays.
			['work-without-people', 'side', ['macro-call', null]],
		]);
		const h3 = c.report.findings.find((f) => f.check === 'hard-constraint');
		expect(h3?.facts).toEqual({ attr: 'start', date: null, applies: 1 });
		const problems: string[] = [];
		for (const f of c.report.findings) {
			for (const fix of f.fixes) {
				const r = probe(fix, c.snap, c.index, { to: 'ann', other: 'kick' });
				const p = r && disabledProblem(fix, r);
				if (p) problems.push(`${f.check}: ${p}`);
				if (fix.disabled !== null) expect(r?.status).toBe('refused');
			}
		}
		expect(problems).toEqual([]);
	}, 120_000);
});
