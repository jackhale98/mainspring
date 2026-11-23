// SPDX-License-Identifier: GPL-2.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Delivery } from './deliver';
import type { GanttPngInput } from './gantt-png';
import type { ExportRequest } from './run-export';
import type { TasksCsvInput } from './tasks-csv';
import { scenarioChain } from '../gantt/grid';
import { at, plan } from '../schedule/testing';

const h = vi.hoisted(() => ({
	delivered: [] as Array<{ name: string; phone: boolean }>,
	result: 'copied' as Delivery,
	rendered: 0,
	renderFails: false,
	downloads: [] as Array<{ blob: Blob; name: string }>,
}));

vi.mock('./gantt-png', () => ({
	renderGanttPng: () => {
		h.rendered++;
		return h.renderFails ? Promise.reject(new Error('x')) : Promise.resolve(new Blob(['png']));
	},
}));
vi.mock('./deliver', () => ({
	browserEnv: () => ({}),
	deliverImage: async (png: Promise<Blob>, name: string, o: { phone: boolean }) => {
		await png;
		h.delivered.push({ name, phone: o.phone });
		return h.result;
	},
	downloadBlob: (blob: Blob, name: string) => h.downloads.push({ blob, name }),
}));

const { runExport } = await import('./run-export');

function request(over: Partial<ExportRequest> = {}): ExportRequest & { said: string[] } {
	const said: string[] = [];
	const result = plan([['a', { start: at(0, 9), end: at(0, 17) }]]);
	const tasks: TasksCsvInput = {
		result,
		scenario: 'plan',
		chain: scenarioChain(result.project, 'plan'),
		symbol: () => undefined,
	};
	return {
		kind: 'png',
		plan: 'UI basic',
		phone: false,
		say: (m) => said.push(m),
		picture: () => ({}) as Omit<GanttPngInput, 'dpr'>,
		tasks: () => tasks,
		...over,
		said,
	};
}

beforeEach(() => {
	h.delivered = [];
	h.downloads = [];
	h.result = 'copied';
	h.rendered = 0;
	h.renderFails = false;
});

describe('runExport png', () => {
	it('renders the picture, delivers it under the plan’s name and says it was copied', async () => {
		const r = request({ phone: true });
		await runExport(r);
		expect(h.rendered).toBe(1);
		expect(h.delivered).toEqual([{ name: 'UI-basic-gantt.png', phone: true }]);
		expect(r.said).toEqual(['Copied the Gantt as an image.']);
	});

	it('says where the file went when it was downloaded', async () => {
		h.result = 'downloaded';
		const r = request();
		await runExport(r);
		expect(r.said).toEqual(['Downloaded UI-basic-gantt.png.']);
	});

	it('says nothing after the share sheet, or after the person closed it', async () => {
		for (const result of ['shared', 'cancelled'] as const) {
			h.result = result;
			const r = request();
			await runExport(r);
			expect(r.said).toEqual([]);
		}
	});

	it('says that the picture failed, and does not throw', async () => {
		h.renderFails = true;
		const r = request();
		await runExport(r);
		expect(r.said).toEqual(['The Gantt could not be made into an image.']);
	});
});

describe('runExport csv', () => {
	it('downloads the tasks as UTF-8 CSV with a byte order mark and says so', async () => {
		const r = request({ kind: 'csv' });
		await runExport(r);
		expect(h.rendered).toBe(0);
		expect(h.downloads).toHaveLength(1);
		const d = h.downloads[0];
		expect(d?.name).toBe('UI-basic-tasks.csv');
		expect(d?.blob.type).toBe('text/csv;charset=utf-8');
		const bytes = new Uint8Array(
			await (d?.blob.arrayBuffer() ?? Promise.resolve(new ArrayBuffer(0))),
		);
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		expect(new TextDecoder().decode(bytes.slice(3))).toBe(
			'id,name,start,end,effort,people,complete\r\na,a,2026-01-05 09:00,2026-01-05 17:00,,,\r\n',
		);
		expect(r.said).toEqual(['Downloaded UI-basic-tasks.csv.']);
	});

	it('says that the export failed when the rows cannot be made', async () => {
		const r = request({
			kind: 'csv',
			tasks: () => {
				throw new Error('x');
			},
		});
		await runExport(r);
		expect(h.downloads).toEqual([]);
		expect(r.said).toEqual(['The tasks could not be exported.']);
	});
});
