// SPDX-License-Identifier: GPL-2.0-or-later
// Real engine messages mapped to ranges (phase-1.md 6.6): every file of TaskJuggler's
// Syntax/Errors suite and the negative fixtures is scheduled by the wasm engine in Node
// (engine/golden/run-wasm.mjs). Each message must give one diagnostic inside its file, anchored
// to the engine's line: overlapping it, inside the statement the line belongs to (a task's body
// for errors reported at its header), or just before it (messages TaskJuggler reports after
// the statement). Needs the built engine (npm run build:engine); skipped without it, except with
// DIAGNOSTICS_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import type { ScheduleResult } from '../../engine/protocol';
import { ROOT } from '../../../tests/grammar/corpus';
import { createWorkspace } from '../workspace/workspace';
import { engineDiagnostics, type TjpDiagnostic } from './diagnostics';
import { LOOK_BACK } from './diagnostics-find';
import { contentSpan, engineLine, textString } from './diagnostics-lines';
import type { TjpFile } from './document';
import { buildIndex } from './index';
import { enclosingStatement } from './tree';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['DIAGNOSTICS_ENGINE'] === '1';

function readDir(dir: string): Record<string, string> {
	const files: Record<string, string> = {};
	const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
	for (const f of fs.readdirSync(path.join(ROOT, dir))) {
		if (/\.tj[ip]$/.test(f)) files[f] = decoder.decode(fs.readFileSync(path.join(ROOT, dir, f)));
	}
	return files;
}

function anchored(file: TjpFile, line: number, d: TjpDiagnostic): boolean {
	const span = engineLine(file.text, line);
	if (d.from <= span.to && d.to >= span.from) return true;
	const back = engineLine(file.text, line - LOOK_BACK).from;
	if (d.to <= span.from && d.from >= back) return true;
	const content = contentSpan(file.tree, textString(file.text), span);
	const at = content?.from ?? span.from;
	for (let s = enclosingStatement(file.tree.resolveInner(at, 1)); s; s = s.parent) {
		if (s.from <= d.from && d.to <= s.to && s.name.endsWith('Statement')) return true;
	}
	return false;
}

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('engine messages from real runs', () => {
	it('map every message of the Syntax/Errors suite and the negative fixtures', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		const runs: Array<{ dir: string; entry: string }> = [];
		const errors = 'engine/tj/test/TestSuite/Syntax/Errors';
		for (const f of Object.keys(readDir(errors)).filter((f) => f.endsWith('.tjp')))
			runs.push({ dir: errors, entry: f });
		for (const neg of ['neg-unterminated-string', 'neg-junk-after-cut'])
			runs.push({ dir: `tests/fixtures/tjp/${neg}`, entry: 'plan.tjp' });
		const precision: Record<string, number> = {};
		const failures: string[] = [];
		let revision = 0;
		for (const { dir, entry } of runs.sort((a, b) => (a.entry < b.entry ? -1 : 1))) {
			const files = readDir(dir);
			const s = createWorkspace({ entry, files }).snapshot();
			const r = (await engine.schedule({ files, entry, revision: ++revision })) as ScheduleResult;
			const ds = engineDiagnostics(r, s, buildIndex(s));
			const shown = r.messages.filter((m) => m.level !== 'debug');
			expect(ds).toHaveLength(shown.length);
			for (const [i, d] of ds.entries()) {
				const m = shown[i];
				const file = d.file === null ? undefined : s.files.get(d.file);
				if (!m || !file) throw new Error(`${entry}: no file for ${d.messageId}`);
				precision[d.precision] = (precision[d.precision] ?? 0) + 1;
				if (!(0 <= d.from && d.from <= d.to && d.to <= file.text.length)) {
					failures.push(`${entry} ${m.id}: out of range`);
				}
				const located = m.file !== null && m.line !== null && m.line > 0 && s.files.has(m.file);
				if (located !== (d.precision !== 'none')) failures.push(`${entry} ${m.id}: precision`);
				if (located && m.line !== null && !anchored(file, m.line, d)) {
					failures.push(`${entry} ${m.id} at ${m.line}: range at line ${d.line} is not anchored`);
				}
			}
		}
		expect(failures).toEqual([]);
		// Most messages are placed more precisely than their line.
		const placed = (precision['token'] ?? 0) + (precision['statement'] ?? 0);
		expect(placed).toBeGreaterThan(precision['line'] ?? 0);
	}, 120_000);
});
