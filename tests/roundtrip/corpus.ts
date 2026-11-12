// SPDX-License-Identifier: GPL-2.0-or-later
// The corpora of the round-trip gate (phase-1.md 9.1): every file of every golden plan, read from
// the manifest, plus the T16 fixtures and TaskJuggler's own Syntax/Correct suite. Each plan is a
// workspace seed (entry plus files by path under its root), so a file parses in the context its
// include site gives it.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../grammar/corpus';

export { ROOT };

export interface ManifestPlan {
	id: string;
	kind: string;
	root: string;
	entry: string;
}

export interface PlanCase {
	readonly corpus: 'golden' | 'fixture' | 'syntax-correct';
	readonly id: string;
	/** Repository-relative directory the plan's file paths are relative to. */
	readonly root: string;
	readonly entry: string;
	/** Workspace paths, relative to `root`, in the order the engine read them. */
	readonly files: readonly string[];
}

export const GOLDEN_PLANS = 39;
export const GOLDEN_FILES = 48;
/** The one file that is not valid UTF-8; compared as text (ADR-0003 #1). */
export const INVALID_UTF8_FILE = 'engine/golden/plans/bridge/bom-invalid-utf8/plan.tjp';

const json = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as T;

export function walk(dir: string, base = dir, out: string[] = []): string[] {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, base, out);
		else if (/\.tj[ip]$/.test(e.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
	}
	return out.sort();
}

export function manifest(): ManifestPlan[] {
	return json<ManifestPlan[]>('engine/golden/manifest.json');
}

/** The files each golden's engine run read (`expected/<id>.json`). */
export function goldenPlans(): PlanCase[] {
	return manifest().map((m) => ({
		corpus: 'golden',
		id: m.id,
		root: m.root,
		entry: m.entry,
		files: json<{ files: string[] }>(`engine/golden/expected/${m.id}.json`).files,
	}));
}

/** Each fixture directory is one plan: `plan.tjp` and its includes. */
export function fixturePlans(): PlanCase[] {
	const base = 'tests/fixtures/tjp';
	return fs
		.readdirSync(path.join(ROOT, base), { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => ({
			corpus: 'fixture',
			id: d.name,
			root: `${base}/${d.name}`,
			entry: 'plan.tjp',
			files: walk(path.join(ROOT, base, d.name)),
		}));
}

/** The wider corpus: each Syntax/Correct file is a single-file plan. */
export function syntaxCorrectPlans(): PlanCase[] {
	const base = 'engine/tj/test/TestSuite/Syntax/Correct';
	return walk(path.join(ROOT, base)).map((f) => ({
		corpus: 'syntax-correct',
		id: f,
		root: base,
		entry: f,
		files: [f],
	}));
}

export const readBytes = (file: string): Uint8Array =>
	new Uint8Array(fs.readFileSync(path.join(ROOT, file)));
