// SPDX-License-Identifier: GPL-2.0-or-later
// Counts and the report of a fidelity run: per-intent edits, no-ops and refusals, P4 counts, timings
// and the mutation results. The test files write partial JSON files; the global setup of
// vitest.fidelity.config.ts merges them into test-results/fidelity-report.{md,json}.
import fs from 'node:fs';
import path from 'node:path';
import type { IntentType } from '../../src/lib/tjp/edit/types';
import { REPO } from '../golden/corpus';
import type { Outcome } from './harness';

export interface TypeStats {
	type: string;
	cases: number;
	edits: number;
	noops: number;
	refusals: number;
	/** Refusals aimed at text-only text on purpose. */
	reasons: Record<string, number>;
}

export function tally(outcomes: readonly Outcome[], types: readonly IntentType[]): TypeStats[] {
	return types.map((type) => {
		const mine = outcomes.filter((o) => o.type === type);
		const reasons: Record<string, number> = {};
		for (const o of mine) if (o.reason) reasons[o.reason] = (reasons[o.reason] ?? 0) + 1;
		return {
			type,
			cases: mine.length,
			edits: mine.filter((o) => o.status === 'edit').length,
			noops: mine.filter((o) => o.status === 'noop').length,
			refusals: mine.filter((o) => o.status === 'refused').length,
			reasons,
		};
	});
}

/** Deliberate text-only intents by refusal reason (a missing reason counts as `accepted`). */
export function deliberateCounts(outcomes: readonly Outcome[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const o of outcomes) {
		if (!o.deliberate) continue;
		const k = o.status === 'refused' ? (o.reason ?? 'refused') : 'accepted';
		out[k] = (out[k] ?? 0) + 1;
	}
	return out;
}

export function percentile(xs: readonly number[], p: number): number {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] as number;
}

export interface TextPart {
	seed: number;
	runs: number;
	corpusRuns: number;
	shard: string;
	corpusBasis: string;
	corpusPlans: string[];
	wallMs: number;
	p50Ms: number;
	p95Ms: number;
	maxMs: number;
	perType: TypeStats[];
	/** Intents aimed at text-only text on purpose, by the reason they were refused for. */
	deliberate: Record<string, number>;
	pending: Array<{ type: string; task: string }>;
	failures: string[];
	regressions: { replayed: number };
}
export interface P4Part {
	runs: number;
	okKept: number;
	okBefore: number;
	newErrors: number;
	cases: number;
	wallMs: number;
	p95Ms: number;
	toleratedIds: Record<string, number>;
	failures: string[];
}
export interface MutationPart {
	mutants: Array<{ name: string; caught: boolean; by: string; cases: number }>;
}

export const RESULTS = path.join(REPO, 'test-results');

export function writePart(name: 'text' | 'p4' | 'mutation', data: unknown): void {
	fs.mkdirSync(path.join(RESULTS, 'fidelity'), { recursive: true });
	fs.writeFileSync(
		path.join(RESULTS, 'fidelity', `${name}.json`),
		`${JSON.stringify(data, null, 2)}\n`,
	);
}

export function readPart<T>(name: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(path.join(RESULTS, 'fidelity', `${name}.json`), 'utf8')) as T;
	} catch {
		return null;
	}
}

const ms = (n: number): string => (n >= 100 ? String(Math.round(n)) : n.toFixed(1));

export function renderReport(
	text: TextPart | null,
	p4: P4Part | null,
	mut: MutationPart | null,
): string {
	const out: string[] = ['# Patch fidelity report', ''];
	if (text) {
		out.push(
			`Seed ${text.seed} (FIDELITY_SEED), ${text.runs} generated and ${text.corpusRuns} corpus cases, shard ${text.shard}. ` +
				`Replay one case with FIDELITY_CASE=generated:<seed>:<type>.`,
			'',
			`Wall time ${(text.wallMs / 1000).toFixed(1)} s for the text-only properties (P1, P2, P3, P5, P6); per case p50 ${ms(text.p50Ms)} ms, p95 ${ms(text.p95Ms)} ms, max ${ms(text.maxMs)} ms.`,
			'',
			'| Intent | Cases | Edits | No-ops | Refusals | Refusal reasons |',
			'| --- | ---: | ---: | ---: | ---: | --- |',
		);
		for (const s of text.perType) {
			const why = Object.entries(s.reasons)
				.map(([k, v]) => `${k} ${v}`)
				.join(', ');
			out.push(`| ${s.type} | ${s.cases} | ${s.edits} | ${s.noops} | ${s.refusals} | ${why} |`);
		}
		for (const p of text.pending) out.push(`| ${p.type} | skipped, pending ${p.task} | | | | |`);
		out.push(
			'',
			`Corpus plans (${text.corpusPlans.length}, from tests/fidelity/corpus.json; times: ${text.corpusBasis}): ${text.corpusPlans.join(', ')}.`,
			'',
		);
		out.push(
			`Regression replays (text-only properties): ${text.regressions.replayed}, all must pass.`,
		);
		out.push('');
		if (text.failures.length > 0)
			out.push(
				'## Failures (text-only properties)',
				'',
				...text.failures.map((f) => `- ${f.split('\n').join('\n  ')}`),
				'',
			);
	}
	if (p4) {
		out.push(
			'## P4: still schedules',
			'',
			`${p4.runs} engine runs over ${p4.cases} edited cases (old and new workspace); ok kept in ${p4.okKept} of ${p4.okBefore} cases that scheduled ok before; new error or fatal ids: ${p4.newErrors}. ` +
				`Wall time ${(p4.wallMs / 1000).toFixed(1)} s, p95 ${ms(p4.p95Ms)} ms per case.`,
			'',
		);
		const tol = Object.entries(p4.toleratedIds);
		if (tol.length > 0)
			out.push(
				`Tolerated schedule-dependent ids (phase-1.md 15.19): ${tol.map(([k, v]) => `${k} ${v}`).join(', ')}.`,
				'',
			);
		if (p4.failures.length > 0)
			out.push(
				'### P4 failures',
				'',
				...p4.failures.map((f) => `- ${f.split('\n').join('\n  ')}`),
				'',
			);
	}
	if (mut) {
		out.push(
			'## Mutation meta-test',
			'',
			'| Faulty wrapper | Caught | By | Cases to catch |',
			'| --- | --- | --- | ---: |',
		);
		for (const m of mut.mutants)
			out.push(`| ${m.name} | ${m.caught ? 'yes' : 'NO'} | ${m.by} | ${m.cases} |`);
		out.push('');
	}
	return `${out.join('\n')}\n`;
}
