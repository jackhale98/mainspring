#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Merges the reports of the nightly fidelity shards (phase-1.md 9.3, 12) into one per-intent table, which is
// gate evidence, and checks the rules a single shard cannot: every enforced intent type produced at least 5
// edits across all shards, P4 ran on at least one case in each shard, and no shard reported a failure.
//
//   node scripts/ci/fidelity-merge.mjs <dir> [--out test-results]
//
// With --shards N the run must have exactly N shards; without it the shard count each report names (its
// `text.shard`, "i/n") is used. Either way every index 0..n-1 must be present exactly once, so a missing or
// repeated shard report fails the merge.
//
// <dir> holds one subdirectory (or file prefix) per shard with its fidelity-report.json, as the
// download-artifact step lays them out. Writes fidelity-report-merged.{md,json} to --out and exits 1 when a
// rule fails.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const MIN_EDITS = 5;

/** Every fidelity-report.json below `dir`. */
function reports(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...reports(p));
		else if (name === 'fidelity-report.json') out.push(p);
	}
	return out.sort();
}

export function merge(parts, { shards } = {}) {
	const types = new Map();
	const deliberate = {};
	const p4 = { runs: 0, cases: 0, okBefore: 0, okKept: 0, newErrors: 0, wallMs: 0, p95Ms: 0 };
	const problems = [];
	const tolerated = {};
	let replays = 0;
	const indexes = [];
	const counts = new Set();
	const seeds = new Set();
	let pending = [];
	let wall = 0;
	let p95 = 0;
	parts.forEach(({ file, report }, i) => {
		const { text, p4: engine, mutation } = report;
		if (!text) return void problems.push(`${file}: no text-only results`);
		seeds.add(`${text.seed} (shard ${text.shard})`);
		const m = /^(\d+)\/(\d+)$/.exec(String(text.shard));
		if (m) {
			indexes.push(Number(m[1]));
			counts.add(Number(m[2]));
		} else problems.push(`${file}: no shard "i/n" in the report`);
		replays = Math.max(replays, text.regressions?.replayed ?? 0);
		pending = text.pending ?? pending;
		wall = Math.max(wall, text.wallMs);
		p95 = Math.max(p95, text.p95Ms);
		for (const t of text.perType) {
			const m = types.get(t.type) ?? {
				type: t.type,
				cases: 0,
				edits: 0,
				noops: 0,
				refusals: 0,
				reasons: {},
			};
			m.cases += t.cases;
			m.edits += t.edits;
			m.noops += t.noops;
			m.refusals += t.refusals;
			for (const [k, v] of Object.entries(t.reasons)) m.reasons[k] = (m.reasons[k] ?? 0) + v;
			types.set(t.type, m);
		}
		for (const [k, v] of Object.entries(text.deliberate ?? {}))
			deliberate[k] = (deliberate[k] ?? 0) + v;
		for (const f of text.failures ?? []) problems.push(`${file}: ${f.split('\n')[0]}`);
		if (!engine) problems.push(`${file}: no P4 results`);
		else {
			if (engine.cases === 0) problems.push(`${file}: P4 ran on no case`);
			for (const k of ['runs', 'cases', 'okBefore', 'okKept', 'newErrors']) p4[k] += engine[k];
			for (const [k, v] of Object.entries(engine.toleratedIds ?? {}))
				tolerated[k] = (tolerated[k] ?? 0) + v;
			p4.wallMs = Math.max(p4.wallMs, engine.wallMs);
			p4.p95Ms = Math.max(p4.p95Ms, engine.p95Ms);
			for (const f of engine.failures ?? []) problems.push(`${file}: ${f.split('\n')[0]}`);
		}
		if (i === 0 && mutation)
			problems.push(
				...mutation.mutants.filter((m) => !m.caught).map((m) => `mutant not caught: ${m.name}`),
			);
	});
	// Every shard of the run reported, once each.
	const expected = shards ?? (counts.size === 1 ? [...counts][0] : undefined);
	if (counts.size > 1)
		problems.push(`the reports name different shard counts: ${[...counts].join(', ')}`);
	if (expected === undefined) problems.push('the shard count is unknown: pass --shards N');
	else {
		if (shards !== undefined && counts.size > 0 && ![...counts].every((c) => c === shards)) {
			problems.push(`the reports are for ${[...counts].join(', ')} shards, expected ${shards}`);
		}
		for (let i = 0; i < expected; i++) {
			const n = indexes.filter((x) => x === i).length;
			if (n === 0) problems.push(`shard ${i}/${expected} did not report`);
			if (n > 1) problems.push(`shard ${i}/${expected} reported ${n} times`);
		}
		for (const i of indexes)
			if (i >= expected) problems.push(`shard ${i} is outside 0..${expected - 1}`);
	}
	const rows = [...types.values()];
	for (const r of rows)
		if (r.edits < MIN_EDITS)
			problems.push(
				`${r.type}: ${r.edits} edits in ${r.cases} cases over all shards, need ${MIN_EDITS}`,
			);
	return {
		rows,
		deliberate,
		p4,
		tolerated,
		replays,
		pending,
		problems,
		shards: parts.length,
		seeds: [...seeds],
		wall,
		p95,
	};
}

export function render(m) {
	const out = ['# Patch fidelity report, all shards', ''];
	out.push(
		`${m.shards} shard report(s); seeds ${m.seeds.join(', ')}. Slowest shard: ${(m.wall / 1000).toFixed(1)} s for the text-only properties, per-case p95 up to ${m.p95.toFixed(1)} ms.`,
		'',
	);
	out.push(
		'| Intent | Cases | Edits | No-ops | Refusals | Refusal reasons |',
		'| --- | ---: | ---: | ---: | ---: | --- |',
	);
	for (const r of m.rows) {
		const why = Object.entries(r.reasons)
			.map(([k, v]) => `${k} ${v}`)
			.join(', ');
		out.push(`| ${r.type} | ${r.cases} | ${r.edits} | ${r.noops} | ${r.refusals} | ${why} |`);
	}
	for (const p of m.pending) out.push(`| ${p.type} | skipped, pending ${p.task} | | | | |`);
	out.push(
		'',
		`Intents aimed at text-only text, by refusal reason: ${
			Object.entries(m.deliberate)
				.map(([k, v]) => `${k} ${v}`)
				.join(', ') || 'none'
		}.`,
		'',
	);
	const tol = Object.entries(m.tolerated);
	out.push(
		`Regression replays per shard (text-only properties and P4): ${m.replays}, all passed unless listed below. Tolerated schedule-dependent ids (corpus plans, 15.19 and 15.22): ${tol.map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`,
		'',
	);
	out.push(
		'Six in seven ordinary generated cases are drawn again until the edit API makes an edit, so edit counts are not natural rates; no-op and refusal counts come from the remaining one in seven, the corpus and the aimed cases.',
		'',
	);
	const p = m.p4;
	out.push(
		'## P4: still schedules',
		'',
		`${p.runs} engine runs over ${p.cases} edited cases; ok kept in ${p.okKept} of ${p.okBefore} cases that scheduled ok before; new error or fatal ids: ${p.newErrors}. Slowest shard ${(p.wallMs / 1000).toFixed(1)} s, per-case p95 up to ${p.p95Ms.toFixed(0)} ms.`,
		'',
	);
	out.push(
		m.problems.length === 0 ? 'All rules hold.' : '## Problems',
		...m.problems.map((x) => `- ${x}`),
		'',
	);
	return `${out.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: { out: { type: 'string', default: 'test-results' }, shards: { type: 'string' } },
	});
	const dir = positionals[0];
	if (!dir || !existsSync(dir)) {
		console.error('usage: fidelity-merge.mjs <dir with the shard reports> [--out dir]');
		process.exit(2);
	}
	const parts = reports(dir).map((file) => ({
		file,
		report: JSON.parse(readFileSync(file, 'utf8')),
	}));
	if (parts.length === 0) {
		console.error(`no fidelity-report.json below ${dir}`);
		process.exit(1);
	}
	const merged = merge(parts, values.shards ? { shards: Number(values.shards) } : {});
	mkdirSync(values.out, { recursive: true });
	writeFileSync(join(values.out, 'fidelity-report-merged.md'), render(merged));
	writeFileSync(
		join(values.out, 'fidelity-report-merged.json'),
		`${JSON.stringify(merged, null, 2)}\n`,
	);
	console.log(render(merged));
	process.exit(merged.problems.length === 0 ? 0 : 1);
}
