// SPDX-License-Identifier: GPL-2.0-or-later
// Exporting a plan's files (phase-4.md 7.2 "Fallback", 18.11): one file as itself, several as a
// zip at their paths, the bytes from the codec (BOM and CRLF kept), the lossy files named, and the
// delivery's order (share sheet on a phone when it can take the file, else a download).
import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { ImageEnv } from '../export/deliver';
import { exportPlanFiles, lossyNames, planFile, type PlanFiles } from './export-files';

const enc = new TextEncoder();
const bytesOf = async (f: Blob): Promise<number[]> => [...new Uint8Array(await f.arrayBuffer())];

const ONE: PlanFiles = {
	name: 'CRLF plan',
	entry: 'plans/crlf.tjp',
	files: new Map([['plans/crlf.tjp', '﻿project p "P" 2026-01-05 +1m\r\n']]),
};
const SEVERAL: PlanFiles = {
	name: 'Nested plan (copy)',
	entry: 'plan.tjp',
	files: new Map([
		['plan.tjp', 'project n "N" 2026-03-02 +1m\ninclude "people/team.tji"\n'],
		['people/team.tji', 'resource ana "Ana"\r\n'],
		['work/phase1/tasks.tji', '# caf�\n'],
	]),
};

function env(can: boolean): ImageEnv & { downloads: string[]; shared: string[] } {
	const downloads: string[] = [];
	const shared: string[] = [];
	return {
		downloads,
		shared,
		share: { can: () => can, send: async (f) => void shared.push(f.name) },
		download: (_b, name) => void downloads.push(name),
	};
}

describe('export (7.2)', () => {
	it('exports a one-file plan as that file, byte for byte', async () => {
		const f = planFile(ONE);
		expect(f.name).toBe('crlf.tjp');
		expect(f.type).toBe('text/plain');
		expect(await bytesOf(f)).toEqual([
			0xef,
			0xbb,
			0xbf,
			...enc.encode('project p "P" 2026-01-05 +1m\r\n'),
		]);
	});

	it('exports several files as a zip of them at their paths', async () => {
		const f = planFile(SEVERAL, new Date(2026, 2, 2));
		expect(f.name).toBe('Nested-plan-copy-plan.zip');
		expect(f.type).toBe('application/zip');
		const unzipped = unzipSync(new Uint8Array(await f.arrayBuffer()));
		expect(Object.keys(unzipped).sort()).toEqual([
			'people/team.tji',
			'plan.tjp',
			'work/phase1/tasks.tji',
		]);
		for (const [path, text] of SEVERAL.files)
			expect([...unzipped[path]!]).toEqual([...enc.encode(text)]);
		// The same plan and time give the same bytes.
		expect(await bytesOf(planFile(SEVERAL, new Date(2026, 2, 2)))).toEqual(await bytesOf(f));
	});

	it('names the lossy files it writes, so the caller can ask (18.11)', () => {
		expect(lossyNames(SEVERAL, new Set(['work/phase1/tasks.tji', 'gone.tji']))).toEqual([
			'work/phase1/tasks.tji',
		]);
		expect(lossyNames(ONE, new Set())).toEqual([]);
	});

	it('shares on a phone when the sheet takes the file, else downloads', async () => {
		const phone = env(true);
		expect(await exportPlanFiles(SEVERAL, { phone: true, env: phone })).toEqual({
			delivery: 'shared',
			name: 'Nested-plan-copy-plan.zip',
		});
		expect(phone.shared).toEqual(['Nested-plan-copy-plan.zip']);
		const desk = env(true);
		expect(await exportPlanFiles(ONE, { phone: false, env: desk })).toEqual({
			delivery: 'downloaded',
			name: 'crlf.tjp',
		});
		expect(desk.downloads).toEqual(['crlf.tjp']);
		const cannot = env(false);
		expect((await exportPlanFiles(ONE, { phone: true, env: cannot })).delivery).toBe('downloaded');
		// A person who closes the share sheet has chosen: nothing is downloaded.
		const closed = env(true);
		closed.share!.send = vi.fn(() => Promise.reject(new DOMException('no', 'AbortError')));
		expect((await exportPlanFiles(ONE, { phone: true, env: closed })).delivery).toBe('cancelled');
		expect(closed.downloads).toEqual([]);
	});
});
