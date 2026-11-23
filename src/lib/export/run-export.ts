// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The two exports of the Gantt's "More actions" menu (phase-4.md 18.20, T18), run from one lazily
 * fetched module: the first export fetches this and what it needs (the picture's renderer, the CSV
 * writer, the words it says), a first load none of it (the first-load budget, 12.1). The caller
 * hands over what is on screen as functions, read when the work starts, and `say`, which tells the
 * person what happened (the edit toasts' line, polite for a screen reader; a failure stays until
 * dismissed).
 *
 * The picture's clipboard write is not here: it has to start in the click itself, before this
 * module has arrived (clipboard.ts), so `runExport` is given the write that is already under way,
 * and the picture's promise that the write holds.
 */
import { csvFile, CSV_TYPE } from './csv';
import { browserEnv, deliverFile, deliverImage } from './deliver';
import { exportFileName } from './file-name';
import { renderGanttPng, type GanttPngInput } from './gantt-png';
import { exportDpr } from './png-frame';
import { taskRows, type TasksCsvInput } from './tasks-csv';
import { strings } from '../strings';
import { exportStrings as S } from '../strings-export';

export type ExportKind = 'png' | 'csv';

export interface ExportRequest {
	/** The plan's name, for the file's. */
	readonly plan: string;
	/** A finger is the pointer: the share sheet is a way for a file (deliver.ts). */
	readonly phone: boolean;
	readonly say: (message: string, sticky?: boolean) => void;
	/** What the chart shows now: everything of the picture but its pixel ratio, which is the screen's. */
	readonly picture: () => Omit<GanttPngInput, 'dpr' | 'heading'>;
	readonly tasks: () => TasksCsvInput;
}

/** Draws the picture of what the chart shows now, at the screen's pixel ratio. */
export function renderPicture(r: ExportRequest): Promise<Blob> {
	return renderGanttPng({
		...r.picture(),
		heading: strings.grid.columns.name,
		dpr: exportDpr(globalThis.devicePixelRatio),
	});
}

async function exportPng(
	r: ExportRequest,
	png: Promise<Blob>,
	copying: Promise<boolean> | null,
): Promise<void> {
	const name = exportFileName(r.plan, 'gantt.png');
	const done = await deliverImage(png, copying, name, { phone: r.phone }, browserEnv());
	if (done === 'copied') r.say(S.pngCopied);
	else if (done === 'downloaded') r.say(S.downloaded(name));
	// Shared: the share sheet said it. Cancelled: the person chose.
}

async function exportCsv(r: ExportRequest): Promise<void> {
	const name = exportFileName(r.plan, 'tasks.csv');
	const blob = new Blob([csvFile(taskRows(r.tasks()))], { type: CSV_TYPE });
	if ((await deliverFile(blob, name, { phone: r.phone }, browserEnv())) === 'downloaded')
		r.say(S.downloaded(name));
}

/**
 * Runs one export. For the picture, `png` is its promise (`renderPicture`) and `copying` the
 * clipboard write started with it (null where the clipboard cannot take a picture). A failure is
 * said and logged, never thrown (a menu item has nowhere to report it).
 */
export async function runExport(
	kind: ExportKind,
	r: ExportRequest,
	png: Promise<Blob> | null = null,
	copying: Promise<boolean> | null = null,
): Promise<void> {
	try {
		if (kind === 'png') await exportPng(r, png ?? renderPicture(r), copying);
		else await exportCsv(r);
	} catch (error) {
		console.error('export failed', error);
		r.say(kind === 'png' ? S.pngFailed : S.csvFailed, true);
	}
}
