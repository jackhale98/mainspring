// SPDX-License-Identifier: GPL-2.0-or-later
// Opening files, importing a folder and exporting (phase-4.md 4, 7.2 "Fallback", 13.2, 18.11; T5),
// on every project: on the iPhone this is the real path, as its browser cannot open a folder in
// place. Files from tests/fixtures/storage open as a plan kept only in this browser; a reload opens
// it again; Export gives the plan back as files: one `.tjp` byte for byte (a BOM and CRLF kept), or
// a `.zip` of every file at its path, after asking about a file that had bytes that are not UTF-8.
// A finger exports through the share sheet (stubbed: lib/folder-rig.ts), a mouse by a download.
// "Import folder…" is offered on a fine pointer where folder inputs exist, and keeps the paths.
import { unzipSync } from 'fflate';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { strings } from '../../src/lib/strings';
import { storageStrings } from '../../src/lib/strings-storage';
import { READY_TIMEOUT_MS, editor, strip } from './lib/text-mode';
import { isTouch } from './lib/gantt-rig';
import {
	chooseEntry,
	chooser,
	fixture,
	fixturePath,
	sharedFile,
	withShareStub,
} from './lib/folder-rig';
import { openApp } from './lib/text-mode';

const S = storageStrings.files;

test.setTimeout(READY_TIMEOUT_MS * 2 + 60_000);

const checked = (page: Page) => chooser(page).locator('option:checked');

async function scheduled(page: Page): Promise<void> {
	await expect(strip(page)).toContainText('Scheduled', { timeout: READY_TIMEOUT_MS });
}

/** Exports the open plan: the file's name and bytes, from the share sheet or the download. */
async function exported(page: Page, info: TestInfo): Promise<{ name: string; bytes: Buffer }> {
	if (isTouch(info)) {
		await chooseEntry(page, 'export');
		const f = await sharedFile(page);
		return { name: f.name, bytes: Buffer.from(f.bytes) };
	}
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		chooseEntry(page, 'export'),
	]);
	const p = await download.path();
	const fs = await import('node:fs');
	await expect(page.getByText(S.downloaded(download.suggestedFilename()))).toBeVisible();
	return { name: download.suggestedFilename(), bytes: fs.readFileSync(p) };
}

test.beforeEach(async ({ page }, info) => {
	if (isTouch(info)) await withShareStub(page);
});

test('a file with a BOM and CRLF opens as a plan kept here and exports byte for byte', async ({
	page,
}, info) => {
	await openApp(page, 'ui-basic');
	await page.getByTestId('open-files-input').setInputFiles([fixturePath('bom-crlf', 'plan.tjp')]);
	await expect(checked(page)).toHaveText('plan');
	await scheduled(page);
	await expect(editor(page)).toContainText('project crlf "CRLF plan"');
	// Kept: a reload opens it again.
	await page.reload();
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(checked(page)).toHaveText('plan');
	await scheduled(page);
	const out = await exported(page, info);
	expect(out.name).toBe('plan.tjp');
	expect([...out.bytes]).toEqual([...fixture('bom-crlf')['plan.tjp']!]);
});

test('several files with one that is not UTF-8 export as a zip, after asking', async ({
	page,
}, info) => {
	await openApp(page, 'ui-basic');
	await page
		.getByTestId('open-files-input')
		.setInputFiles([
			fixturePath('invalid-utf8', 'plan.tjp'),
			fixturePath('invalid-utf8', 'notes.tji'),
		]);
	await expect(checked(page)).toHaveText('plan');
	await scheduled(page);
	// The person is asked first; refusing exports nothing.
	const asked: string[] = [];
	page.once('dialog', (d) => {
		asked.push(d.message());
		void d.dismiss();
	});
	await chooseEntry(page, 'export');
	await expect.poll(() => asked).toEqual([S.lossy(['notes.tji'])]);
	page.once('dialog', (d) => void d.accept());
	const out = await exported(page, info);
	expect(out.name).toBe('plan-plan.zip');
	const zip = unzipSync(new Uint8Array(out.bytes));
	const disk = fixture('invalid-utf8');
	expect(Object.keys(zip).sort()).toEqual(['notes.tji', 'plan.tjp']);
	expect([...zip['plan.tjp']!]).toEqual([...disk['plan.tjp']!]);
	// The byte that was not UTF-8 is a replacement character now, as the question said.
	const notes = disk['notes.tji']!;
	const at = notes.indexOf(0xe9);
	expect([...zip['notes.tji']!]).toEqual([
		...notes.subarray(0, at),
		0xef,
		0xbf,
		0xbd,
		...notes.subarray(at + 1),
	]);
});

test('Import folder… keeps the paths of a plan in nested folders, where a folder input is offered', async ({
	page,
}, info) => {
	await openApp(page, 'ui-basic');
	const offered = (await chooser(page).locator('option').allInnerTexts()).includes(
		strings.planFiles.importFolder,
	);
	// Offered on a fine pointer where the browser has folder inputs (7.2: desktop only).
	expect(offered).toBe(
		!isTouch(info) && (await page.evaluate(() => 'webkitdirectory' in HTMLInputElement.prototype)),
	);
	if (offered) {
		await page.getByTestId('import-folder-input').setInputFiles(fixturePath('nested'));
	} else {
		// The same files picked one by one keep no folders: the includes cannot be found, but the
		// plan opens, and its files are kept by name.
		await page
			.getByTestId('open-files-input')
			.setInputFiles([
				fixturePath('nested', 'plan.tjp'),
				fixturePath('nested', 'people', 'team.tji'),
				fixturePath('nested', 'work', 'phase1', 'tasks.tji'),
			]);
	}
	await expect(checked(page)).toHaveText(offered ? 'nested' : 'plan');
	await expect(editor(page)).toContainText('project nest "Nested plan"');
	if (offered) {
		await scheduled(page);
		const out = await exported(page, info);
		const zip = unzipSync(new Uint8Array(out.bytes));
		const disk = fixture('nested');
		expect(Object.keys(zip).sort()).toEqual([
			'people/team.tji',
			'plan.tjp',
			'work/phase1/tasks.tji',
		]);
		for (const p of Object.keys(zip)) expect([...zip[p]!]).toEqual([...disk[p]!]);
	}
});
