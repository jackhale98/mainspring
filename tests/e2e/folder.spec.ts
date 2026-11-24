// SPDX-License-Identifier: GPL-2.0-or-later
// Folder plans (phase-4.md 4, 7.2, 13.2, 13.4, 18.22; T5), on small plans from
// tests/fixtures/storage. Where the browser has the File System Access API (Chromium: desktop and
// Pixel 7), `showDirectoryPicker` is replaced by a stand-in that returns a folder of the
// origin-private file system, a real handle (lib/folder-rig.ts): a folder opens as a plan kept here
// with the folder as its location, nothing is written to it, and a reload opens it again; a folder of
// several plans asks which, and opening it again opens the one chosen; Save to folder… writes every
// file once, byte for byte, and never over a file that is there; and on /dev/folder the provider
// itself, on a real handle, writes only what it is given, keeps a BOM, CRLF and invalid bytes, refuses
// to write over a change on disk (`moved`), tells a touch from a change (19.14), keeps its handles
// across a reload, and asks for the permission again ("Reconnect").
// Without the API (the iPhone's browser, and Chromium with the picker taken away) the folder entries
// are absent and the fallback is offered: Open files, Export, "Only in this browser" (13.4). That
// test runs on every project; the others need the API, which is a capability, not a project.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { strings } from '../../src/lib/strings';
import { storageStrings } from '../../src/lib/strings-storage';
import { READY_TIMEOUT_MS, editor, openApp, strip } from './lib/text-mode';
import {
	bytesOf,
	chooseEntry,
	chooser,
	fixture,
	fixturePath,
	hasFolderApi,
	pickNext,
	readFolder,
	seedFolder,
	withPicker,
	withoutFolderApi,
} from './lib/folder-rig';

const S = storageStrings.files;
const F = strings.planFiles;

test.setTimeout(READY_TIMEOUT_MS * 2 + 60_000);

const checked = (page: Page) => chooser(page).locator('option:checked');
const options = (page: Page) => chooser(page).locator('option');

/** The plan's files as the file switcher lists them (tabs, or a select on a narrow layout). */
async function fileList(page: Page): Promise<string[]> {
	const tabs = page.getByRole('tablist', { name: strings.editor.files });
	if (await tabs.isVisible()) return tabs.getByRole('tab').allInnerTexts();
	return page.getByLabel(strings.editor.file).locator('option').allInnerTexts();
}

async function scheduled(page: Page): Promise<void> {
	await expect(strip(page)).toContainText('Scheduled', { timeout: READY_TIMEOUT_MS });
}

test.describe('without the File System Access API', () => {
	test('offers no folder entries; Open files, Export and "Only in this browser" are there', async ({
		page,
	}) => {
		// The iPhone's browser has no picker; on Chromium it is taken away, so the same branch runs.
		await withoutFolderApi(page);
		await openApp(page, 'ui-basic');
		expect(await hasFolderApi(page)).toBe(false);
		const labels = await options(page).allInnerTexts();
		expect(labels).not.toContain(F.openFolder);
		expect(labels).not.toContain(F.saveToFolder);
		expect(labels).toContain(F.openFiles);
		expect(labels).toContain(F.export);
		// Opened files are kept only in this browser, and the line says so where there is one.
		await page.getByTestId('open-files-input').setInputFiles([fixturePath('bom-crlf', 'plan.tjp')]);
		await expect(checked(page)).toHaveText('plan');
		await scheduled(page);
		const line = page.getByTestId('keep-line');
		if (await line.isVisible()) await expect(line).toHaveText(strings.keep.stored);
	});
});

test.describe('with the File System Access API', () => {
	test.beforeEach(async ({ page }) => {
		await withPicker(page);
		await page.goto('/dev/folder');
		test.skip(
			!(await hasFolderApi(page)),
			'This browser has no File System Access API: the test without it covers this browser.',
		);
	});

	test('opens a folder as a plan kept with it, writes nothing there, and reopens after a reload', async ({
		page,
	}) => {
		await openApp(page, 'ui-basic');
		const files = fixture('nested');
		await seedFolder(page, 'nested', files);
		const before = await readFolder(page, 'nested');
		await pickNext(page, 'nested');
		await chooseEntry(page, 'openFolder');
		await expect(checked(page)).toHaveText('nested');
		await scheduled(page);
		expect((await fileList(page)).sort()).toEqual([
			'people/team.tji',
			'plan.tjp',
			'work/phase1/tasks.tji',
		]);
		await expect(editor(page)).toContainText('project nest "Nested plan"');
		// Saving to a folder is not offered for a plan that is in one.
		expect(await options(page).allInnerTexts()).not.toContain(F.saveToFolder);
		// Nothing was written: the same bytes and times on disk.
		expect(await readFolder(page, 'nested')).toEqual(before);

		await page.reload();
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(checked(page)).toHaveText('nested');
		await scheduled(page);
		await expect(editor(page)).toContainText('project nest "Nested plan"');
		expect(await readFolder(page, 'nested')).toEqual(before);
	});

	test('asks which plan in a folder of several, and opens the same folder as it was kept', async ({
		page,
	}) => {
		await openApp(page, 'ui-basic');
		await seedFolder(page, 'several', fixture('several'));
		await pickNext(page, 'several');
		await chooseEntry(page, 'openFolder');
		const ask = page.getByTestId('plan-question');
		await expect(ask).toContainText(storageStrings.notice.which('several', 2));
		await expect(ask.getByRole('button')).toHaveText(['alpha.tjp', 'beta.tjp', 'Cancel']);
		await expect(ask.getByRole('button', { name: 'alpha.tjp' })).toBeFocused();
		const axe = await new AxeBuilder({ page })
			.include('[data-testid="plan-question"]')
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
			.analyze();
		expect(axe.violations).toEqual([]);
		await ask.getByRole('button', { name: 'beta.tjp' }).click();
		await expect(checked(page)).toHaveText('several: beta.tjp');
		await expect(editor(page)).toContainText('project beta');

		// Another plan, then the same folder again: the plan chosen there opens, with no question.
		await chooser(page).selectOption({ label: strings.samples['ui-people'] });
		await expect(checked(page)).toHaveText(strings.samples['ui-people']);
		await chooseEntry(page, 'openFolder');
		await expect(checked(page)).toHaveText('several: beta.tjp');
		await expect(ask).toHaveCount(0);
		await expect(editor(page)).toContainText('project beta');
	});

	test('Save to folder… writes every file once, byte for byte, and never over a file that is there', async ({
		page,
	}) => {
		await openApp(page, 'ui-basic');
		const sample = fixture('../ui/basic');
		await seedFolder(page, 'dest', {});
		await pickNext(page, 'dest');
		await chooseEntry(page, 'saveToFolder');
		await expect(page.getByText(S.savedTo('dest'))).toBeVisible();
		await expect(checked(page)).toHaveText('dest');
		const plan = Object.fromEntries(
			Object.entries(sample).filter(([p]) => p.endsWith('.tjp') || p.endsWith('.tji')),
		);
		expect(bytesOf(await readFolder(page, 'dest'))).toEqual(
			Object.fromEntries(Object.entries(plan).map(([p, b]) => [p, [...b]])),
		);
		const written = await readFolder(page, 'dest');

		// Another plan to the same folder: its files are there, so nothing is written.
		await chooser(page).selectOption({ label: strings.samples['ui-people'] });
		await expect(checked(page)).toHaveText(strings.samples['ui-people']);
		await chooseEntry(page, 'saveToFolder');
		await expect(
			page.getByText(/is already in that folder|are already in that folder/),
		).toBeVisible();
		expect(await readFolder(page, 'dest')).toEqual(written);
		await expect(checked(page)).toHaveText(strings.samples['ui-people']);
	});
});

test.describe('the folder provider on a real handle (/dev/folder)', () => {
	test.beforeEach(async ({ page }) => {
		await withPicker(page);
		await page.goto('/dev/folder');
		await expect(page.getByTestId('state')).toHaveText('ready');
		test.skip(
			!(await hasFolderApi(page)),
			'This browser has no File System Access API: the test without it covers this browser.',
		);
	});

	test('writes only what it is given, refuses a change on disk, tells a touch from a change, keeps its handles', async ({
		page,
	}) => {
		const files = { ...fixture('bom-crlf'), ...fixture('invalid-utf8') };
		// Two plans' files in one folder: plan.tjp from bom-crlf is replaced by invalid-utf8's.
		await seedFolder(page, 'real', { ...files, 'crlf/plan.tjp': fixture('bom-crlf')['plan.tjp']! });
		await pickNext(page, 'real');
		const disk0 = await readFolder(page, 'real');
		const r = await page.evaluate(async () => {
			type Folder = typeof import('../../src/lib/storage/folder') &
				typeof import('../../src/lib/storage/codec') &
				typeof import('../../src/lib/storage/folder-changes');
			const f = (window as unknown as { __folder: Folder }).__folder;
			const p = f.createFolderProvider();
			const loc = await p.pick();
			if (!loc) throw new Error('no folder');
			sessionStorage.setItem('loc', JSON.stringify(loc));
			const read = await p.read(loc);
			const base = f.decodeSnapshot(read);
			const head0 = await p.head(loc);
			// Only the entry changes; the lossy file and the CRLF file are not named.
			const text = `${base.files.get('plan.tjp')}# changed\n`;
			const w = await p.write(loc, {
				base: read.revision,
				files: new Map([['plan.tjp', f.encodePlanFile(text)]]),
				message: null,
			});
			const after = w.status === 'written' ? w.revision : '';
			return {
				paths: [...read.files.keys()],
				lossy: [...base.lossy],
				sameHead: head0 === read.revision,
				written: w.status,
				headAfter: (await p.head(loc)) === after,
				access: await p.access(loc),
			};
		});
		expect(r).toEqual({
			paths: ['crlf/plan.tjp', 'notes.tji', 'plan.tjp'],
			lossy: ['notes.tji'],
			sameHead: true,
			written: 'written',
			headAfter: true,
			access: 'granted',
		});
		const disk1 = await readFolder(page, 'real');
		// The unchanged files keep their bytes and times; the entry is the edited text exactly.
		expect(disk1['notes.tji']).toEqual(disk0['notes.tji']);
		expect(disk1['crlf/plan.tjp']).toEqual(disk0['crlf/plan.tjp']);
		expect(Buffer.from(disk1['plan.tjp']!.bytes).toString('utf8')).toBe(
			`${files['plan.tjp']!.toString('utf8')}# changed\n`,
		);

		// After a reload the handle comes back from IndexedDB; the permission asks again (Reconnect).
		await page.evaluate(() => sessionStorage.setItem('folder-permission', 'prompt'));
		await page.reload();
		await expect(page.getByTestId('state')).toHaveText('ready');
		const r2 = await page.evaluate(async () => {
			type Folder = typeof import('../../src/lib/storage/folder') &
				typeof import('../../src/lib/storage/codec') &
				typeof import('../../src/lib/storage/folder-changes');
			const f = (window as unknown as { __folder: Folder }).__folder;
			const p = f.createFolderProvider();
			const loc = JSON.parse(sessionStorage.getItem('loc') ?? '{}');
			const before = await p.access(loc);
			const asked = await p.requestAccess(loc);
			return { before, asked, ok: typeof loc.handle === 'string' };
		});
		expect(r2).toEqual({ before: 'prompt', asked: 'granted', ok: true });
		const r3 = await page.evaluate(async () => {
			type Folder = typeof import('../../src/lib/storage/folder') &
				typeof import('../../src/lib/storage/codec') &
				typeof import('../../src/lib/storage/folder-changes');
			const f = (window as unknown as { __folder: Folder }).__folder;
			const p = f.createFolderProvider();
			const loc = JSON.parse(sessionStorage.getItem('loc') ?? '{}');
			const read = await p.read(loc);
			const base = { ...f.decodeSnapshot(read) };
			// A touch: every file written again with the same bytes.
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('real');
			const rewrite = async (name: string, bytes: Uint8Array): Promise<void> => {
				const w = await (await dir.getFileHandle(name)).createWritable();
				await w.write(bytes as Uint8Array<ArrayBuffer>);
				await w.close();
			};
			const time = async (name: string): Promise<number> =>
				(await (await dir.getFileHandle(name)).getFile()).lastModified;
			// Another program saves a file with no change: the same bytes, until its time moves.
			const was = await time('notes.tji');
			while ((await time('notes.tji')) === was)
				await rewrite('notes.tji', read.files.get('notes.tji')!);
			const touched = await f.folderChange(p, loc, base);
			// A write on the old base is refused: the stamps moved, nothing is written.
			const refused = await p.write(loc, {
				base: read.revision,
				files: new Map([['plan.tjp', f.encodePlanFile('mine\n')]]),
				message: null,
			});
			await rewrite('plan.tjp', f.encodePlanFile('theirs\n'));
			const changed = await f.folderChange(p, loc, base);
			const planNow = await (await (await dir.getFileHandle('plan.tjp')).getFile()).text();
			return {
				touched: touched.kind,
				refused: refused.status,
				changed: changed.kind,
				paths: changed.kind === 'changed' ? changed.paths : [],
				planNow,
			};
		});
		expect(r3).toEqual({
			touched: 'touched',
			refused: 'moved',
			changed: 'changed',
			paths: ['plan.tjp'],
			planNow: 'theirs\n',
		});
	});
});
