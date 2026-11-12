// SPDX-License-Identifier: GPL-2.0-or-later
// Helpers shared by the fidelity test files: the recorded regressions, building a case from its
// seed, and a failure message with the replay command.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpusCase, generatedCase } from './cases';
import type { PlannedCase } from './config';
import type { Case, Outcome } from './harness';

export interface Regression {
	source: 'generated' | 'corpus';
	seed: number;
	type: PlannedCase['type'];
	status: 'regression' | 'known-failure';
	reason: string;
	found: string;
	/** A known failure's shape: intent fields and the new error ids, so P4 can skip its repeats. */
	match?: { intent: Record<string, unknown>; errors: string[] };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const REGRESSIONS: Regression[] = (
	JSON.parse(fs.readFileSync(path.join(HERE, 'regressions.json'), 'utf8')) as {
		cases: Regression[];
	}
).cases;

export function buildCase(p: Pick<PlannedCase, 'source' | 'seed' | 'type'>): Case {
	return p.source === 'generated' ? generatedCase(p.seed, p.type) : corpusCase(p.seed, p.type);
}

export function describeFailure(
	c: Case,
	o: Outcome,
	extra: readonly string[] = o.failures,
): string {
	const head = `${c.source} seed ${c.seed} ${c.type} on ${c.name}: ${JSON.stringify(c.drawn.intent).slice(0, 300)} -> ${o.status}${o.reason ? ` (${o.reason})` : ''}`;
	return `${head}\n${extra.map((f) => `    ${f}`).join('\n')}\n    replay: FIDELITY_CASE=${c.source}:${c.seed}:${c.type}`;
}

/** The known failure a P4 failure repeats (same intent fields, only the listed new error ids). */
export function knownP4(c: Case, newErrors: readonly string[]): Regression | null {
	const intent = c.drawn.intent as unknown as Record<string, unknown>;
	return (
		REGRESSIONS.find(
			(r) =>
				r.status === 'known-failure' &&
				r.match &&
				Object.entries(r.match.intent).every(([k, v]) => intent[k] === v) &&
				newErrors.length > 0 &&
				newErrors.every((e) => r.match?.errors.includes(e)),
		) ?? null
	);
}
