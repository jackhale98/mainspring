// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Opening plans from a folder or from files, Save to… a folder, and Export (phase-4.md 4, 7.2,
 * 18.11, 18.22; state/app-storage.ts `openFolder`, `openFiles`, `saveTo`): the part of `AppState`
 * that loads lazily, with the folder provider (storage/folder.ts) and the import
 * (storage/import.ts); Export fetches storage/export-files.ts (and `fflate`) when first used.
 * `AppState` hands it what it needs as a `PlanFilesHost`.
 *
 * - **Open folder** (Chromium): the picker first, inside the gesture. A folder kept here already
 *   (the same location, folder.ts `pick`) opens as it was kept: what was chosen there is
 *   remembered (18.22). Otherwise its plan files are read; with several `.tjp` files the host's
 *   `choose` asks which; the plan is stored at once with the folder as its location and what was
 *   read as its sync base (nothing is written to the folder).
 * - **Open files and Import folder** (every browser): the plan files among them make a
 *   browser-only plan, stored at once, which records the files that had bytes that are not UTF-8
 *   (`StoredPlan.from.lossy`, 18.11). Several `.tjp` files ask which, as above.
 * - **Save to… a folder** (app-storage.ts `saveTo`): a browser-only plan or a sample's copy writes
 *   every file once into a folder without plan files, in any case (`exists`, nothing written; T5
 *   review M5), never over a file that is there (the provider's checks; H1). The plan's own files
 *   with its bytes, or empty, left by a Save to… that did not finish, are taken, so doing it again
 *   finishes it (M4). A plan whose paths differ only by case is refused. Then the plan lives there:
 *   it is stored anew at the folder, with what was written as its base, and the browser copy (made
 *   by the flush, M2) is removed. The workspace stays open, its history too; its first save stores
 *   every file, so what was typed while it moved is kept. `saveToSentence` words the outcome for
 *   T15's flow. GitHub is T8's.
 * - **Opened files whose paths differ only by case** are refused, saying so (H1).
 * - **Export**: the plan's text now as one `.tjp` or a `.zip`, by the share sheet on a phone or a
 *   download (export-files.ts).
 * - **Invalid bytes** (18.11): Save to… and Export write every file, so files that had bytes that
 *   are not UTF-8 are named first, and nothing is written unless the person agrees.
 * - **What goes wrong** is said through `say` (strings-storage.ts `files`), never thrown.
 */
import { decodeSnapshot, encodeFiles } from '../storage/codec';
import { caseClash, createFolderProvider, type FolderProvider } from '../storage/folder';
import { importName, planEntries, readImport, type ImportFile } from '../storage/import';
import type { StoredPlan, SyncBase } from '../storage/store-types';
import {
	isStorageFailure,
	storageError,
	type FolderLocation,
	type Location,
	type StorageError,
	type WorkspaceId,
	type WorkspacePath,
} from '../storage/types';
import type { SyncOutcome } from '../sync/types';
import { storageStrings } from '../strings-storage';
import type { SampleWorkspace } from '../workspace/samples';
import type { Workspace } from '../workspace/workspace';
import {
	copyPlanPrefs,
	type MadeAt,
	type Opening,
	type PlanKeeper,
	type Unstored,
	type Where,
} from './plan-keeper';
import type { ListedStorage } from './storage';

const S = storageStrings.files;

/** What the person is asked when a folder or the opened files hold several plans (18.22). */
export interface PlanQuestion {
	/** The folder's name; '' for opened files. */
	readonly where: string;
	/** The `.tjp` files, the shallowest first. */
	readonly plans: readonly WorkspacePath[];
}

/** Asks which plan to open; null when the person cancels. */
export type ChoosePlan = (q: PlanQuestion) => Promise<WorkspacePath | null>;

/** "Which plan?" with its answer, as the notice shows it (`AppState.planQuestion`). */
export type PlanAsk = PlanQuestion & { readonly answer: (p: WorkspacePath | null) => void };

/** Asks through the host's notice. */
const asking =
	(h: PlanFilesHost): ChoosePlan =>
	(q) =>
		new Promise((resolve) => {
			h.ask({
				...q,
				answer: (p) => {
					h.ask(null);
					resolve(p);
				},
			});
		});

/** The open plan, as Save to… and Export read it. */
export interface OpenPlan {
	readonly ws: Workspace;
	readonly storedId: WorkspaceId | null;
	readonly label: string;
	readonly where: Where;
	/** How a plan open unstored (a sample) is stored: its `from`. */
	readonly unstored: Unstored | null;
	readonly readOnly: boolean;
}

/** What `AppState` gives this module (module comment). */
export interface PlanFilesHost {
	keeper(): Promise<PlanKeeper>;
	/** Stores what autosave holds, then asks when changes would be lost; false to stay. */
	leave(): Promise<boolean>;
	/** Stores a new plan and opens it (unstored when the store fails, as New plan does). */
	make(u: Unstored, seed: SampleWorkspace, at?: MadeAt): Promise<boolean>;
	openStored(id: WorkspaceId): Promise<boolean>;
	open(): OpenPlan | null;
	/**
	 * Workspace `ws` is kept as `o` from now on (Save to…); false, with `o`'s lock given up, when
	 * another plan opened meanwhile.
	 */
	adopt(ws: Workspace, o: Opening): boolean;
	flush(): Promise<boolean>;
	confirm(message: string): boolean;
	say(message: string, sticky?: boolean): void;
	/** Shows "which plan?" (`AppState.planQuestion`), or nothing (null). */
	ask(q: PlanAsk | null): void;
	/** A finger is the pointer: Export offers the share sheet. */
	phone(): boolean;
	/** Where the preferences are kept, and the open plan's preference key (Save to… copies them). */
	prefs(): ListedStorage | null;
	key(): string;
}

let provider: FolderProvider | null = null;

/** The folder provider, one for the page (a test gives its own). */
export function folderProvider(p?: FolderProvider): FolderProvider {
	if (p) provider = p;
	return (provider ??= createFolderProvider());
}

/** The sentence for a failure (strings-storage.ts `files`). */
function sentence(e: StorageError): string {
	switch (e.kind) {
		case 'too-large':
			return S.tooLarge;
		case 'permission':
			return S.permission;
		case 'not-found':
			return S.gone;
		case 'unsupported':
			return S.unsupported;
		case 'quota':
			return S.quota;
		default:
			return S.unreadable;
	}
}

const errorOf = (e: unknown): StorageError =>
	isStorageFailure(e) ? e.error : storageError('server', 'plan-files');

/** The entry: the only `.tjp`, or the one the person chooses; null when none or cancelled. */
async function entryOf(
	plans: readonly WorkspacePath[],
	where: string,
	choose: ChoosePlan,
): Promise<WorkspacePath | null> {
	if (plans.length <= 1) return plans[0] ?? null;
	const c = await choose({ where, plans });
	return c !== null && plans.includes(c) ? c : null;
}

/** "Open folder…" (module comment). */
export async function openFolder(
	h: PlanFilesHost,
	choose: ChoosePlan = asking(h),
): Promise<boolean> {
	const p = folderProvider();
	let loc: FolderLocation | null;
	try {
		loc = await p.pick();
	} catch (e) {
		h.say(sentence(errorOf(e)), true);
		return false;
	}
	if (!loc) return false;
	const handle = loc.handle;
	const kept = await h
		.keeper()
		.then((k) => k.plans())
		.catch((): readonly StoredPlan[] => []);
	const known = kept.find((s) => s.location.kind === 'folder' && s.location.handle === handle);
	if (known) return h.openStored(known.id);
	let base: ReturnType<typeof decodeSnapshot>;
	try {
		base = decodeSnapshot(await p.read(loc));
	} catch (e) {
		h.say(sentence(errorOf(e)), true);
		return false;
	}
	const plans = planEntries(base.files.keys());
	if (plans.length === 0) {
		h.say(S.noPlan, true);
		return false;
	}
	const entry = await entryOf(plans, loc.name, choose);
	if (entry === null || !(await h.leave())) return false;
	const name = plans.length > 1 ? `${loc.name}: ${entry}` : loc.name;
	return h.make(
		{ name, label: name, from: { opened: true } },
		{ entry, files: Object.fromEntries(base.files) },
		{ location: loc, base: { ...base, kept: new Set(), summary: null } },
	);
}

/** "Open files…" and "Import folder…" (module comment). */
export async function openFiles(
	h: PlanFilesHost,
	files: readonly ImportFile[],
	choose: ChoosePlan = asking(h),
): Promise<boolean> {
	const r = await readImport(files);
	if (r.kind !== 'plan') {
		h.say(
			r.kind === 'no-plan'
				? S.noPlan
				: r.kind === 'case'
					? S.sameNameOpen(...r.paths)
					: sentence(r.error),
			true,
		);
		return false;
	}
	const plan = r.plan;
	const entry = await entryOf(plan.plans, plan.folder ?? '', choose);
	if (entry === null || !(await h.leave())) return false;
	const name = importName(plan, entry);
	const from =
		plan.lossy.size > 0 ? { opened: true as const, lossy: plan.lossy } : { opened: true as const };
	return h.make({ name, label: name, from }, { entry, files: Object.fromEntries(plan.files) });
}

/** The folder picker alone, for Save to… (T15's flow picks, then calls `saveTo`). */
export async function pickFolder(h: PlanFilesHost): Promise<FolderLocation | null> {
	try {
		return await folderProvider().pick();
	} catch (e) {
		h.say(sentence(errorOf(e)), true);
		return null;
	}
}

const failed = (error: StorageError): SyncOutcome => ({ kind: 'failed', error });

/** The names of the lossy files the plan has: Save to… and Export write them all (18.11). */
const lossyOf = (cur: OpenPlan, files: Readonly<Record<WorkspacePath, string>>): string[] =>
	[...cur.where.lossy].filter((p) => p in files).sort();

const same = (a: Uint8Array | undefined, b: Uint8Array): boolean =>
	a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

/** Save to… (module comment; app-storage.ts `saveTo`). */
export async function saveTo(h: PlanFilesHost, target: Location): Promise<SyncOutcome> {
	if (target.kind === 'browser') return { kind: 'browser-only' };
	if (target.kind === 'github') return failed(storageError('unsupported', 'save-to: github'));
	const asked = h.open();
	if (!asked) return { kind: 'cancelled' };
	if (asked.readOnly) return failed(storageError('not-owner', 'save-to: read-only'));
	if (asked.where.location.kind !== 'browser') {
		return failed(storageError('unsupported', 'save-to: already at a provider'));
	}
	const clash = caseClash(Object.keys(asked.ws.texts()).sort());
	if (clash) {
		h.say(S.sameNameSave(...clash), true);
		return { kind: 'cancelled' };
	}
	const lossy = lossyOf(asked, asked.ws.texts());
	if (lossy.length > 0 && !h.confirm(S.lossy(lossy))) return { kind: 'cancelled' };
	await h.flush();
	// After the flush: a sample's first change may just have stored its copy (M2).
	const cur = h.open();
	if (!cur || cur.ws !== asked.ws) return { kind: 'cancelled' };
	const p = folderProvider();
	const access = await p.access(target);
	if (access !== 'granted') return { kind: 'needs-access', access };
	const texts = cur.ws.texts();
	const bytes = encodeFiles(new Map(Object.entries(texts)));
	let base: string;
	const ours = new Set<WorkspacePath>();
	try {
		// Only a folder without plan files, in any case (M5). The plan's own files with its bytes,
		// left by a Save to… that did not finish, are taken as written, and an empty file at one of
		// its paths (the residual of a failed write, types.ts contract notes T5) is written over:
		// nothing is in it to lose (M4).
		const there = await p.planNames(target);
		if (there.length > 0) {
			const read = await p.read(target);
			const empty = new Set<WorkspacePath>();
			for (const f of there) {
				const mine = bytes.get(f);
				const now = read.files.get(f);
				if (mine && same(now, mine)) ours.add(f);
				else if (mine && now?.length === 0) empty.add(f);
			}
			const others = there.filter((f) => !ours.has(f) && !empty.has(f));
			if (others.length > 0) return { kind: 'exists', files: others };
			base = read.revision;
		} else {
			const head = await p.head(target);
			if (head === null) return failed(storageError('not-found', 'save-to: no folder'));
			base = head;
		}
	} catch (e) {
		return failed(errorOf(e));
	}
	const write = new Map([...bytes].filter(([f]) => !ours.has(f)));
	const r = await p.write(target, { base, files: write, message: null });
	if (r.status === 'failed') return failed(r.error);
	if (r.status === 'moved') {
		// Someone wrote there meanwhile; say what is there now (or that it changed).
		const now = await p.planNames(target).catch((): WorkspacePath[] => []);
		const others = now.filter((f) => !bytes.has(f));
		return others.length > 0
			? { kind: 'exists', files: others }
			: failed(storageError('server', 'save-to: the folder changed'));
	}
	// What is on disk now is valid UTF-8: the new base has no lossy file. Its revision names the
	// plan's files only, as the folder holds no other plan file (M5).
	const synced: SyncBase = {
		revision: r.revision,
		files: new Map(Object.entries(texts)),
		lossy: new Set(),
		kept: new Set(),
		summary: null,
	};
	const was = cur.where.from ?? cur.unstored?.from ?? { opened: true };
	const from: StoredPlan['from'] = 'opened' in was ? { opened: true } : was;
	let opening: Opening;
	try {
		const k = await h.keeper();
		// The text now, with what was typed meanwhile (the first save stores every file again).
		const seed = { entry: cur.ws.snapshot().entry, files: cur.ws.texts() };
		opening = await k.create({ name: target.name, label: target.name, from }, seed, {
			location: target,
			base: synced,
		});
		// The views' preferences go with the plan (as a sample's copy's do, plan-keeper.ts).
		copyPlanPrefs(h.prefs(), h.key(), opening.key);
		// The browser copy goes only once the open workspace is the folder's plan.
		if (h.adopt(cur.ws, { ...opening, all: true }) && cur.storedId !== null) {
			await k.remove(cur.storedId).catch(() => undefined);
		}
	} catch (e) {
		return failed(errorOf(e));
	}
	return { kind: 'synced', revision: r.revision, pulled: false, pushed: write.size };
}

/**
 * What a Save to… outcome says, for T15's flow (strings-storage.ts `files`; T5 review M4, M6). It
 * reads the outcome's kind and the error's kind, never its detail (L3). A `failed` may come after
 * some files were written, so it says that Save to… again finishes them (`saveTo` takes the plan's
 * own files that are there).
 */
export function saveToSentence(o: SyncOutcome, folder: string): string | null {
	switch (o.kind) {
		case 'synced':
			return S.savedTo(folder);
		case 'exists':
			return S.planThere(o.files);
		case 'needs-access':
			return S.permission;
		case 'failed':
			return o.error.kind === 'not-owner' ? S.readOnly : S.saveFailed(folder);
		default:
			return null;
	}
}

/** Export (module comment). */
export async function exportPlan(h: PlanFilesHost): Promise<void> {
	const cur = h.open();
	if (!cur) return;
	const texts = cur.ws.texts();
	const lossy = lossyOf(cur, texts);
	if (lossy.length > 0 && !h.confirm(S.lossy(lossy))) return;
	try {
		const m = await import('../storage/export-files');
		const files = new Map(Object.entries(texts));
		const plan = { name: cur.label, entry: cur.ws.snapshot().entry, files };
		const r = await m.exportPlanFiles(plan, { phone: h.phone() });
		if (r.delivery === 'downloaded') h.say(S.downloaded(r.name));
	} catch (e) {
		console.error('export failed', e);
		h.say(S.exportFailed, true);
	}
}
