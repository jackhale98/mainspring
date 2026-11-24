// SPDX-License-Identifier: GPL-2.0-or-later
// Opening plan files as a copy (phase-4.md 7.2 "Fallback", 7.4, 18.11, 18.22): paths, the plan
// files kept, the limits before any read, the codec's text and `lossy`, the possible entries.
import { describe, expect, it } from 'vitest';
import { importName, importPath, readImport, type ImportFile } from './import';
import { PLAN_LIMITS } from './types';

const enc = new TextEncoder();

/** A picked file; `rel` is a folder import's `webkitRelativePath`. */
function file(
	name: string,
	content: Uint8Array | string,
	rel = '',
): ImportFile & { reads: number } {
	const bytes = typeof content === 'string' ? enc.encode(content) : content;
	const f = {
		name,
		webkitRelativePath: rel,
		size: bytes.length,
		reads: 0,
		arrayBuffer: () => {
			f.reads++;
			return Promise.resolve(bytes.slice().buffer);
		},
	};
	return f;
}

describe('import (7.2)', () => {
	it('takes a folder import’s paths without the picked folder, and plain files by name', () => {
		expect(importPath(file('team.tji', '', 'acme/people/team.tji'))).toBe('people/team.tji');
		expect(importPath(file('plan.tjp', '', 'acme/plan.tjp'))).toBe('plan.tjp');
		expect(importPath(file('plan.tjp', ''))).toBe('plan.tjp');
	});

	it('keeps the plan files as text, BOM and CRLF included, and names the lossy ones', async () => {
		const bomCrlf = Uint8Array.of(
			0xef,
			0xbb,
			0xbf,
			...enc.encode('project p "P" 2026-01-05 +1m\r\n'),
		);
		const r = await readImport([
			file('plan.tjp', bomCrlf, 'acme/plan.tjp'),
			file('team.tji', Uint8Array.of(0x23, 0xe9, 0x0a), 'acme/people/team.tji'),
			file('notes.txt', 'not a plan', 'acme/notes.txt'),
			file('.hidden.tji', 'x', 'acme/sub/../x.tji'),
		]);
		expect(r.kind).toBe('plan');
		if (r.kind !== 'plan') return;
		expect(r.plan.folder).toBe('acme');
		expect([...r.plan.files.keys()]).toEqual(['plan.tjp', 'people/team.tji']);
		expect(r.plan.files.get('plan.tjp')).toBe('﻿project p "P" 2026-01-05 +1m\r\n');
		expect(r.plan.files.get('people/team.tji')).toBe('#�\n');
		expect([...r.plan.lossy]).toEqual(['people/team.tji']);
		expect(r.plan.plans).toEqual(['plan.tjp']);
		expect(importName(r.plan, 'plan.tjp')).toBe('acme');
	});

	it('lists every .tjp as a possible entry, the shallowest first; keeps the first of a path', async () => {
		const r = await readImport([
			file('z.tjp', 'project z'),
			file('a.tjp', 'project a'),
			file('a.tjp', 'second copy'),
		]);
		expect(r.kind === 'plan' && r.plan.plans).toEqual(['a.tjp', 'z.tjp']);
		expect(r.kind === 'plan' && r.plan.files.get('a.tjp')).toBe('project a');
		expect(r.kind === 'plan' && importName(r.plan, 'z.tjp')).toBe('z');
		const deep = await readImport([file('b.tjp', '', 'f/old/b.tjp'), file('c.tjp', '', 'f/c.tjp')]);
		expect(deep.kind === 'plan' && deep.plan.plans).toEqual(['c.tjp', 'old/b.tjp']);
	});

	it('has no plan without a .tjp', async () => {
		expect(await readImport([file('team.tji', 'resource a "A"\n'), file('x.txt', '')])).toEqual({
			kind: 'no-plan',
		});
		expect(await readImport([])).toEqual({ kind: 'no-plan' });
	});

	it('refuses a plan past the limits without reading a byte', async () => {
		const big = file('plan.tjp', new Uint8Array(PLAN_LIMITS.fileBytes + 1));
		const small = file('a.tji', 'x');
		expect(await readImport([big, small])).toEqual({
			kind: 'failed',
			error: { kind: 'too-large', retryAfterMs: null, detail: 'import: file' },
		});
		expect(big.reads + small.reads).toBe(0);
		const many = [file('plan.tjp', '')];
		for (let i = 0; i < PLAN_LIMITS.files; i++) many.push(file(`f${i}.tji`, ''));
		expect(await readImport(many)).toMatchObject({
			kind: 'failed',
			error: { detail: 'import: files' },
		});
	});

	it('says when a file could not be read', async () => {
		const gone: ImportFile = {
			name: 'plan.tjp',
			size: 1,
			arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotFoundError')),
		};
		expect(await readImport([gone])).toEqual({
			kind: 'failed',
			error: { kind: 'not-found', retryAfterMs: null, detail: 'import: NotFoundError' },
		});
		const broken: ImportFile = { ...gone, arrayBuffer: () => Promise.reject(new Error('x')) };
		expect(await readImport([broken])).toMatchObject({ kind: 'failed', error: { kind: 'server' } });
	});
});
