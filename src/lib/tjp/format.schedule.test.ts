// SPDX-License-Identifier: GPL-2.0-or-later
// Formatted golden plans schedule identically (phase-1.md 7.3): every golden plan's files are
// formatted (a file with syntax errors is refused and sent as it is) and the wasm engine, booted
// in Node by engine/golden/run-wasm.mjs, must still give the plan's golden result. The corpus is
// mostly formatted already, so each plan is also formatted with a tab unit, which re-indents
// nearly every line. Needs the built engine (npm run build:engine); skipped
// without it.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	bootNodeEngine,
	compareWithGolden,
	loadCorpus,
	planRequest,
} from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import { createWorkspace } from '../workspace/workspace';
import { changeSetOf, type TjpFile } from './document';
import { formatFile } from './format';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');

interface Golden {
	entry: string;
	files: string[];
	options: { now: string | null };
	result: unknown;
}

/** The formatted text of a file, or its own text when format refuses it. */
function formatted(file: TjpFile, unit?: string): string {
	const r = formatFile(file, unit === undefined ? {} : { unit });
	if (r.status !== 'format') return file.text.toString();
	return changeSetOf([...r.changes], file.text.length)
		.apply(file.text)
		.toString();
}

describe.skipIf(!fs.existsSync(ENGINE))('formatted golden plans schedule identically', () => {
	it('matches every golden with the detected unit and with a tab unit', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		let revision = 0;
		const failures: string[] = [];
		const changed = new Map<string, number>();
		const corpus = loadCorpus() as Array<{ plan: { id: string; root: string }; golden: Golden }>;
		for (const unit of [undefined, '\t']) {
			const label = JSON.stringify(unit ?? 'detected');
			for (const { plan, golden } of corpus) {
				const request = planRequest(plan, golden, ++revision);
				const snap = createWorkspace({ entry: golden.entry, files: request.files }).snapshot();
				const files: Record<string, string> = {};
				for (const [p, file] of snap.files) {
					files[p] = formatted(file, unit);
					const lines = file.text.toString().split('\n');
					const diff = files[p].split('\n').filter((l, i) => l !== lines[i]).length;
					changed.set(label, (changed.get(label) ?? 0) + diff);
				}
				expect(Object.keys(files).sort()).toEqual(Object.keys(request.files).sort());
				const result = engine.schedule({ ...request, files });
				const diffs = compareWithGolden(golden, { ...result });
				if (diffs.length > 0) failures.push(`${plan.id} ${label}: ${diffs.slice(0, 5).join('; ')}`);
			}
		}
		console.log(`format schedule check: lines changed per unit ${JSON.stringify([...changed])}`);
		expect(failures).toEqual([]);
	}, 300_000);
});
