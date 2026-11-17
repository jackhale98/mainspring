// SPDX-License-Identifier: GPL-2.0-or-later
// A fix is disabled exactly when the edit API refuses its edit as text-only, and with the same
// reason (section 12: "text-only tasks are reported, and their fixes are disabled with the
// reason"; types.ts `Fix.disabled`). Checked on every finding of the recorded goldens below:
// each intent fix is dry-run with its own intent, "Replace person…" with another person, and a
// pick with another task. fedora-res holds macro-written dates and tasks (Fedora's
// `start ${start_work}`), so its fixes include disabled ones.
import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../../tests/golden/corpus';
import { checkPlan } from './report';
import { disabledProblem, goldenEditable, probe } from './testing';

const IDS = [
	'fedora-res',
	'syn-20-scale-1000',
	...loadCorpus()
		.map((c) => c.plan.id)
		.filter((id) => id.startsWith('health-') || id.startsWith('workload-')),
];

describe('fixes are disabled as the edit API refuses them', () => {
	it.each(IDS)(
		'%s',
		(id) => {
			const { input, snap } = goldenEditable(id);
			const { index } = input;
			const people = [...index.resources.values()].filter((r) => r.children.length === 0);
			const tasks = [...index.tasks.values()].filter((t) => !t.expandedOnly);
			const problems: string[] = [];
			let probed = 0;
			let disabled = 0;
			// Many findings share a fix (every Fedora leaf's "Remove start" is the root's): once each.
			const seen = new Set<string>();
			for (const f of checkPlan(input).findings) {
				for (const fix of f.fixes) {
					const key = JSON.stringify(fix);
					if (seen.has(key)) continue;
					seen.add(key);
					const to = people.find((p) => fix.kind === 'replace-person' && p.id !== fix.from)?.id;
					const other = tasks.find(
						(t) => fix.kind === 'pick' && t.id !== fix.task && !t.id.startsWith(`${fix.task}.`),
					)?.id;
					const r = probe(fix, snap, index, { ...(to ? { to } : {}), ...(other ? { other } : {}) });
					if (fix.kind === 'open' || fix.kind === 'why' || fix.kind === 'show') {
						expect(fix.disabled).toBeNull();
					}
					if (!r) continue;
					probed++;
					if (fix.disabled !== null) disabled++;
					const p = disabledProblem(fix, r);
					if (p) problems.push(`${f.check} ${JSON.stringify(f.subject)}: ${p}`);
				}
			}
			expect(problems).toEqual([]);
			if (id === 'fedora-res') {
				// 394 distinct fixes; the disabled ones are "Remove start" on the three macro-written
				// starts (`f20`, `f20.DevelopmentPhase`, `f20.TestingPhase.alpha`) 355 leaves inherit.
				expect(probed).toBeGreaterThan(300);
				expect(disabled).toBe(3);
			}
		},
		120_000,
	);
});
