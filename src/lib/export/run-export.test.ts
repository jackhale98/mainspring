// SPDX-License-Identifier: GPL-2.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Delivery } from './deliver';
import type { GanttPngInput } from './gantt-png';
import type { ExportRequest } from './run-export';
import type { TasksCsvInput } from './tasks-csv';
import { scenarioChain } from '../gantt/grid';
import { at, plan } from '../schedule/testing';

const h = vi.hoisted(() => ({
	delivered: [] as Array<{ name: string; phone: boolean; copying: Promise<boolean> | null }>,
	files: [] as Array<{ blob: Blob; name: string; phone: boolean }>,
	result: 'copied' as Delivery,
	rendered: 0,
	dpr: [] as number[],
	renderFails: false,
}));

vi.mock('./gantt-png', () => ({
	renderGanttPng: (i: { dpr: number }) => {
		h.rendered++;
		h.dpr.push(i.dpr);
		return h.renderFails ? Promise.reject(new Error('x')) : Promise.resolve(new Blob(['png']));
	},
}));
vi.mock('./deliver', () => ({
	browserEnv: () => ({}),
	deliverImage: async (
		png: Promise<Blob>,
		copying: Promise<boolean> | null,
		name: string,
		o: { phone: boolean },
	) => {
		await png;
		h.delivered.push({ name, phone: o.phone, copying });
		return h.result;
	},
	deliverFile: async (blob: Blob, name: string, o: { phone: boolean }) => {
		h.files.push({ blob, name, phone: o.phone });
		return h.result;
	},
}));

const { renderPicture, runExport } = await import('./run-export');

type Said = Array<[string, boolean | undefined]>;

function request(over: Partial<ExportRequest> = {}): ExportRequest & { said: Said } {
	const said: Said = [];
	const result = plan([['a', { start: at(0, 9), end: at(0, 17) }]]);
	const tasks: TasksCsvInput = {
		result,
		scenario: 'plan',
		chain: scenarioChain(result.project, 'plan'),
		symbol: () => undefined,
	};
	return {
		plan: 'UI basic',
		phone: false,
		say: (m, sticky) => said.push([m, sticky]),
		picture: () => ({}) as Omit<GanttPngInput, 'dpr' | 'heading'>,
		tasks: () => tasks,
		...over,
		said,
	};
}

beforeEach(() => {
	h.delivered = [];
	h.files = [];
	h.result = 'copied';
	h.rendered = 0;
	h.dpr = [];
	h.renderFails = false;
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('renderPicture', () => {
	it('draws at the screen’s pixel ratio, from 1 to 3', async () => {
		vi.stubGlobal('devicePixelRatio', 5);
		await renderPicture(request());
		vi.stubGlobal('devicePixelRatio', 2);
		await renderPicture(request());
		vi.unstubAllGlobals();
		expect(h.dpr).toEqual([3, 2]);
	});
});

describe('runExport png', () => {
	it('delivers the picture under the plan’s name with the clipboard write the click started', async () => {
		const r = request({ phone: true });
		const copying = Promise.resolve(true);
		await runExport('png', r, Promise.resolve(new Blob(['png'])), copying);
		expect(h.delivered).toEqual([{ name: 'UI-basic-gantt.png', phone: true, copying }]);
		expect(r.said).toEqual([['Copied the Gantt as an image.', undefined]]);
	});

	it('draws the picture itself when none was started', async () => {
		await runExport('png', request());
		expect(h.rendered).toBe(1);
		expect(h.delivered).toHaveLength(1);
	});

	it('says where the file went when it was downloaded', async () => {
		h.result = 'downloaded';
		const r = request();
		await runExport('png', r, Promise.resolve(new Blob([])), null);
		expect(r.said).toEqual([['Downloaded UI-basic-gantt.png.', undefined]]);
	});

	it('says nothing after the share sheet, or after the person closed it', async () => {
		for (const result of ['shared', 'cancelled'] as const) {
			h.result = result;
			const r = request();
			await runExport('png', r, Promise.resolve(new Blob([])), null);
			expect(r.said).toEqual([]);
		}
	});

	it('says, until dismissed, that the picture failed, logs why, and does not throw', async () => {
		h.renderFails = true;
		const r = request();
		await runExport('png', r);
		expect(r.said).toEqual([['The Gantt could not be made into an image.', true]]);
		expect(console.error).toHaveBeenCalled();
	});
});

describe('runExport csv', () => {
	it('delivers the tasks as UTF-8 CSV with a byte order mark and says where they went', async () => {
		h.result = 'downloaded';
		const r = request();
		await runExport('csv', r);
		expect(h.rendered).toBe(0);
		expect(h.files).toHaveLength(1);
		const d = h.files[0];
		expect(d?.name).toBe('UI-basic-tasks.csv');
		expect(d?.blob.type).toBe('text/csv;charset=utf-8');
		const bytes = new Uint8Array(
			await (d?.blob.arrayBuffer() ?? Promise.resolve(new ArrayBuffer(0))),
		);
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		expect(new TextDecoder().decode(bytes.slice(3))).toBe(
			'id,name,start,end,effort,people,complete\r\na,a,2026-01-05 09:00,2026-01-05 17:00,,,\r\n',
		);
		expect(r.said).toEqual([['Downloaded UI-basic-tasks.csv.', undefined]]);
	});

	it('offers a finger the share sheet, and says nothing once it has taken the file', async () => {
		h.result = 'shared';
		const r = request({ phone: true });
		await runExport('csv', r);
		expect(h.files[0]?.phone).toBe(true);
		expect(r.said).toEqual([]);
	});

	it('says, until dismissed, that the export failed when the rows cannot be made', async () => {
		const r = request({
			tasks: () => {
				throw new Error('x');
			},
		});
		await runExport('csv', r);
		expect(h.files).toEqual([]);
		expect(r.said).toEqual([['The tasks could not be exported.', true]]);
	});
});
