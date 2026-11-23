// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The two exports of the Gantt's "More actions" menu (phase-4.md 18.20, T18), run from one lazily
 * fetched module: the first export fetches this and what it needs (the picture's renderer, the CSV
 * writer, the words it says), a first load none of it (the first-load budget, 12.1). The caller
 * hands over what is on screen as functions, read when the work starts, and `say`, which tells the
 * person what happened (the edit toasts' line, polite for a screen reader).
 */
import { csvFile, CSV_TYPE } from './csv';
import { browserEnv, deliverImage, downloadBlob } from './deliver';
import { exportFileName } from './file-name';
import { renderGanttPng, type GanttPngInput } from './gantt-png';
import { exportDpr } from './png-frame';
import { taskRows, type TasksCsvInput } from './tasks-csv';
import { exportStrings as S } from '../strings-export';

export type ExportKind = 'png' | 'csv';

export interface ExportRequest {
	readonly kind: ExportKind;
	/** The plan's name, for the file's. */
	readonly plan: string;
	/** A finger is the pointer: the share sheet is a way for the picture (deliver.ts). */
	readonly phone: boolean;
	readonly say: (message: string) => void;
	/** What the chart shows now: everything of the picture but its pixel ratio, which is the screen's. */
	readonly picture: () => Omit<GanttPngInput, 'dpr'>;
	readonly tasks: () => TasksCsvInput;
}

async function exportPng(r: ExportRequest): Promise<void> {
	const name = exportFileName(r.plan, 'gantt.png');
	const png = renderGanttPng({ ...r.picture(), dpr: exportDpr(globalThis.devicePixelRatio) });
	const done = await deliverImage(png, name, { phone: r.phone }, browserEnv());
	if (done === 'copied') r.say(S.pngCopied);
	else if (done === 'downloaded') r.say(S.downloaded(name));
	// Shared: the share sheet said it. Cancelled: the person chose.
}

function exportCsv(r: ExportRequest): void {
	const name = exportFileName(r.plan, 'tasks.csv');
	downloadBlob(new Blob([csvFile(taskRows(r.tasks()))], { type: CSV_TYPE }), name);
	r.say(S.downloaded(name));
}

/** Runs one export; a failure is said, never thrown (a menu item has nowhere to report it). */
export async function runExport(r: ExportRequest): Promise<void> {
	try {
		if (r.kind === 'png') await exportPng(r);
		else exportCsv(r);
	} catch {
		r.say(r.kind === 'png' ? S.pngFailed : S.csvFailed);
	}
}
