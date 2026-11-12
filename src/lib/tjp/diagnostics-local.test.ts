// SPDX-License-Identifier: GPL-2.0-or-later
// Local diagnostics (phase-1.md 6.6 item 5, 15.2): syntax errors from the tree, value checks of
// typed statements, undeclared custom attributes; none on the correct corpora.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../engine/runtime';
import { CORPORA, NEGATIVE, readTjp } from '../../../tests/grammar/corpus';
import { diagnosticStrings } from '../strings';
import { createWorkspace } from '../workspace/workspace';
import { createFile } from './document';
import { localDiagnostics, syntaxDiagnostics } from './diagnostics';
import { buildIndex } from './index';
import { inline } from './index/testing';

const zones = createTimeZoneHost();
const HEAD = 'project p "P" 2026-01-05 +3m { now 2026-01-05 }\nresource r "R"\n';

function local(body: string): Array<[string, string, string, string | null]> {
	const text = HEAD + body;
	const s = inline({ 'plan.tjp': text }).snapshot();
	return localDiagnostics(s, buildIndex(s, undefined, { zones })).map((d) => [
		d.messageId,
		text.slice(d.from, d.to),
		d.message,
		d.hint,
	]);
}

const syntax = (body: string) =>
	syntaxDiagnostics(createFile('plan.tjp', HEAD + body)).map((d) => [
		d.messageId,
		(HEAD + body).slice(d.from, d.to),
		d.line,
	]);

describe('syntaxDiagnostics', () => {
	it('marks an unknown keyword', () => {
		expect(syntax('task a "A" {\n  effort 2d\n  colour "red"\n}\n')).toEqual([
			['syntax:unexpected', 'colour', 5],
		]);
	});

	it('marks an unterminated string on its first line only', () => {
		expect(syntax('task a "A {\n  effort 2d\n}\n')).toEqual([['syntax:unterminated', '"A {', 3]]);
	});

	it('places a missing closing brace after the last content', () => {
		expect(syntax('task a "A" {\n  effort 2d\n\n\n')).toEqual([['syntax:unexpected-end', '', 4]]);
	});

	it('names an unmatched closing brace', () => {
		expect(syntax('task a "A" {\n  effort 2d\n}\n}\n')).toEqual([['syntax:extra-brace', '}', 6]]);
	});

	it('widens a zero-width error to the token after it', () => {
		expect(syntax('task a "A" {\n  note "x" @@ 2d\n}\n')).toEqual([['syntax:unexpected', '@', 4]]);
	});

	for (const [file, line] of NEGATIVE) {
		it(`puts the first error of ${file} on the engine's line ${line}`, () => {
			const d = syntaxDiagnostics(createFile(file, readTjp(file)));
			expect(d[0]?.line).toBe(line);
		});
	}
});

describe('value diagnostics', () => {
	it('reports checkValue errors with the strings table', () => {
		expect(local('task a "A" {\n  scheduling foo\n  effort 0d\n  priority 5000\n}\n')).toEqual([
			['value:unexpected-token', 'foo', diagnosticStrings.value['unexpected-token'], null],
			['effort_zero', '0d', diagnosticStrings.value['duration-too-small'], null],
			['task_priority', '5000', diagnosticStrings.value['number-range'], null],
		]);
	});

	it('checks dates against the project settings in force', () => {
		expect(
			local(
				'task a "A" {\n  start 2026-01-05-09:17\n  end 2027-01-01\n  depends b { gapduration 0d }\n}\n',
			),
		).toEqual([
			['misaligned_date', '2026-01-05-09:17', diagnosticStrings.value['misaligned-date'], null],
			['date_in_range', '2027-01-01', diagnosticStrings.value['out-of-project'], null],
			['zero_duration', '0d', diagnosticStrings.value['zero-duration'], null],
		]);
		expect(local('task a "A" {\n  start 2026-01-05-09:15\n}\n')).toEqual([
			['misaligned_date', '2026-01-05-09:15', diagnosticStrings.value['misaligned-date'], null],
		]);
	});

	it('does not check values written with macros, or values in reports', () => {
		expect(
			local(
				'macro d [0d]\ntask a "A" {\n  effort ${d}\n}\ntaskreport x "x" {\n  start 2001-01-01\n}\n',
			),
		).toEqual([]);
	});

	it('leaves values in error regions to the syntax diagnostics', () => {
		expect(local('task a "A" {\n  effort 2dd\n}\n').map((d) => d[0])).toEqual([
			'syntax:unexpected',
		]);
	});

	it('needs time-zone data for zone-dependent checks', () => {
		const text =
			'project p "P" 2026-01-05 +1m {\n  timezone "Asia/Kathmandu"\n  timingresolution 30min\n}\n';
		const s = inline({ 'plan.tjp': text }).snapshot();
		expect(localDiagnostics(s, buildIndex(s))).toEqual([]);
		expect(
			localDiagnostics(s, buildIndex(s, undefined, { zones })).map((d) => d.messageId),
		).toEqual(['too_large_timing_res']);
	});
});

describe('undeclared custom attributes (15.2)', () => {
	it('reports a name no extend declares, with a keyword hint ignoring case', () => {
		expect(local('task a "A" {\n  Effort 2d\n  Phone "x"\n}\nresource b "B" { Rate 3 }\n')).toEqual(
			[
				[
					'attribute:undeclared',
					'Effort',
					diagnosticStrings.undeclaredAttribute('Effort'),
					'Did you mean effort?',
				],
				['attribute:undeclared', 'Phone', diagnosticStrings.undeclaredAttribute('Phone'), null],
				[
					'attribute:undeclared',
					'Rate',
					diagnosticStrings.undeclaredAttribute('Rate'),
					'Did you mean rate?',
				],
			],
		);
	});

	it('accepts declared attributes, also in another file, and suggests their spelling', () => {
		const s = createWorkspace({
			entry: 'plan.tjp',
			files: {
				'plan.tjp':
					'project p "P" 2026-01-05 +1m {\n  include "ext.tji"\n}\ntask a "A" {\n  Phone "1"\n  PHONE "2"\n}\n',
				'ext.tji': 'extend task {\n  text Phone "Phone"\n}\n',
			},
		}).snapshot();
		const d = localDiagnostics(s, buildIndex(s));
		expect(
			d.map((x) => [s.files.get(x.file ?? '')?.text.sliceString(x.from, x.to), x.hint]),
		).toEqual([['PHONE', 'Did you mean Phone?']]);
	});

	it('reports a statement once when its file is read twice', () => {
		const s = createWorkspace({
			entry: 'plan.tjp',
			files: {
				'plan.tjp':
					'project p "P" 2026-01-05 +1m\ntask g1 "G1" {}\ntask g2 "G2" {}\ninclude "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
				't.tji': 'task t "T" {\n  Owner "x"\n}\n',
			},
		}).snapshot();
		expect(localDiagnostics(s, buildIndex(s)).map((d) => d.messageId)).toEqual([
			'attribute:undeclared',
		]);
	});

	it('needs an index of the same snapshot for value and attribute checks', () => {
		const ws = inline({ 'plan.tjp': `${HEAD}task a "A" {\n  Effort 2d\n}\n` });
		const idx = buildIndex(ws.snapshot());
		ws.commit(
			'plan.tjp',
			ws.state('plan.tjp').update({ changes: { from: 0, insert: ' ' } }),
			'typing',
		);
		expect(localDiagnostics(ws.snapshot(), idx)).toEqual([]);
		expect(localDiagnostics(ws.snapshot())).toEqual([]);
	});
});

describe('no false positives on the corpora', () => {
	const skip = new Set(NEGATIVE.keys());
	for (const corpus of CORPORA) {
		it(`finds nothing in ${corpus.name} except the known negatives`, () => {
			const found: string[] = [];
			for (const file of corpus.files) {
				if (skip.has(file) || !file.endsWith('.tjp')) continue;
				const dir = path.posix.dirname(file);
				const files: Record<string, string> = {};
				for (const other of corpus.files) {
					if (other.startsWith(`${dir}/`)) files[other.slice(dir.length + 1)] = readTjp(other);
				}
				const entry = file.slice(dir.length + 1);
				const s = createWorkspace({ entry, files }).snapshot();
				const idx = buildIndex(s, undefined, { zones });
				const read = new Set(idx.visits.map((v) => v.file));
				for (const d of localDiagnostics(s, idx)) {
					const full = `${dir}/${d.file ?? ''}`;
					if (!skip.has(full) && read.has(d.file ?? ''))
						found.push(`${full}:${d.line} ${d.messageId}`);
				}
			}
			expect([...new Set(found)]).toEqual(
				corpus.name === 'golden plans'
					? [
							'engine/golden/plans/synthetic/22-tz-kathmandu-resolution/plan.tjp:9 too_large_timing_res',
						]
					: [],
			);
		}, 60_000);
	}
});
