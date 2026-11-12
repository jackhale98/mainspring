// SPDX-License-Identifier: GPL-2.0-or-later
// Helpers shared by the fidelity test files: the recorded regressions, building a case from its seed,
// a failure message with the replay command, and a guard that turns a throw into a failure message.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpusCase, generatedCase } from './cases';
import type { PlannedCase } from './config';
import type { Case, Outcome } from './harness';

/** A case that failed once and replays on every run. It must pass; a fixed bug stays here. */
export interface Regression {
	source: 'generated' | 'corpus';
	seed: number;
	type: PlannedCase['type'];
	/** For a corpus case: the golden plan it ran on. */
	plan?: string;
	/** Set for a generated case aimed at text-only text. */
	aim?: 'text-only';
	reason: string;
	found: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const REGRESSIONS: Regression[] = (
	JSON.parse(fs.readFileSync(path.join(HERE, 'regressions.json'), 'utf8')) as {
		cases: Regression[];
	}
).cases;

export function buildCase(p: Pick<PlannedCase, 'source' | 'seed' | 'type' | 'plan' | 'aim'>): Case {
	return p.source === 'generated'
		? generatedCase(p.seed, p.type, p.aim)
		: corpusCase(p.seed, p.type, p.plan);
}

/** Everything needed to replay a case: source, seed, type and, for a corpus case, its plan. */
export const replayLine = (c: Pick<Case, 'source' | 'seed' | 'type' | 'name' | 'aim'>): string =>
	`FIDELITY_CASE=${c.source}:${c.seed}:${c.type}${c.source === 'corpus' ? `:${c.name}` : c.aim ? `:${c.aim}` : ''}`;

export function describeFailure(
	c: Case,
	o: Pick<Outcome, 'status' | 'reason' | 'failures'>,
	extra: readonly string[] = o.failures,
): string {
	const head = `${c.source} seed ${c.seed} ${c.type} on ${c.name}: ${JSON.stringify(c.drawn.intent).slice(0, 300)} -> ${o.status}${o.reason ? ` (${o.reason})` : ''}`;
	return `${head}\n${extra.map((f) => `    ${f}`).join('\n')}\n    replay: ${replayLine(c)}`;
}

/** Runs `fn`; a throw (in the generator, the edit API or the harness) becomes a failure with its replay line. */
export function guarded<T>(
	p: Pick<PlannedCase, 'source' | 'seed' | 'type' | 'plan' | 'aim'>,
	fn: () => T,
): { value: T } | { failure: string } {
	try {
		return { value: fn() };
	} catch (error) {
		const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
		const name = p.plan ?? '';
		return {
			failure: `${p.source} seed ${p.seed} ${p.type}: threw ${stack.split('\n').slice(0, 4).join(' | ')}\n    replay: ${replayLine({ ...p, name, ...(p.aim ? { aim: p.aim } : {}) })}`,
		};
	}
}
