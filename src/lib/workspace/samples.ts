// SPDX-License-Identifier: GPL-2.0-or-later
/// <reference types="vite/client" />
/**
 * Bundled sample workspaces for Text mode (phase-1.md 6.2, 8.1 sample picker): the PoC sample,
 * upstream TaskJuggler's Tutorial, synthetic plan 18 (several files, `include` from a subfolder,
 * macros, `supplement`) and upstream Fedora 20 (414 tasks, macro ids, an included report file).
 *
 * Each sample loads lazily through dynamic `?raw` imports, so it costs nothing until picked. Vite
 * decodes `?raw` files as UTF-8 and keeps a BOM, as `decodeWorkspaceFile` does (ADR-0002 #13;
 * samples.test.ts checks that the texts match). The upstream examples ship unmodified, with
 * the notices in their text: Tutorial is part of TaskJuggler (GPL-2.0-only); Fedora 20 is by
 * John Poelstra and Robyn Bergeron under the MIT (Expat) license. THIRD_PARTY_NOTICES.md lists
 * both.
 */
import { strings } from '../strings';
import type { WorkspacePath } from './paths';

export interface SampleWorkspace {
	entry: WorkspacePath;
	files: Record<WorkspacePath, string>;
}

export interface Sample {
	/** Also the golden plan id in engine/golden/manifest.json. */
	id: keyof typeof strings.samples;
	label: string;
	load(): Promise<SampleWorkspace>;
}

type RawModule = Promise<{ default: string }>;

/** Loads the files of one sample in parallel. */
async function loadFiles(
	entry: WorkspacePath,
	files: Readonly<Record<WorkspacePath, () => RawModule>>,
): Promise<SampleWorkspace> {
	const paths = Object.keys(files);
	const texts = await Promise.all(paths.map((p) => files[p]?.() ?? Promise.reject(new Error(p))));
	const out: Record<WorkspacePath, string> = {};
	paths.forEach((p, i) => {
		out[p] = texts[i]?.default ?? '';
	});
	return { entry, files: out };
}

function sample(
	id: Sample['id'],
	entry: WorkspacePath,
	files: Readonly<Record<WorkspacePath, () => RawModule>>,
): Sample {
	return { id, label: strings.samples[id], load: () => loadFiles(entry, files) };
}

export const SAMPLES: readonly Sample[] = [
	sample('poc-sample', 'plan.tjp', {
		'plan.tjp': () => import('../../../engine/golden/plans/poc-sample/plan.tjp?raw'),
	}),
	sample('upstream-tutorial', 'tutorial.tjp', {
		'tutorial.tjp': () => import('../../../engine/tj/examples/Tutorial/tutorial.tjp?raw'),
	}),
	sample('syn-18-structure-include-macro', 'plan.tjp', {
		'plan.tjp': () =>
			import('../../../engine/golden/plans/synthetic/18-structure-include-macro/plan.tjp?raw'),
		'lib/resources.tji': () =>
			import('../../../engine/golden/plans/synthetic/18-structure-include-macro/lib/resources.tji?raw'),
		'lib/tasks.tji': () =>
			import('../../../engine/golden/plans/synthetic/18-structure-include-macro/lib/tasks.tji?raw'),
	}),
	sample('upstream-fedora-20', 'f-20.tjp', {
		'f-20.tjp': () => import('../../../engine/tj/examples/Fedora-20/f-20.tjp?raw'),
		'reports.tji': () => import('../../../engine/tj/examples/Fedora-20/reports.tji?raw'),
	}),
];

/** The sample with this id, or null. */
export function sampleById(id: string): Sample | null {
	return SAMPLES.find((s) => s.id === id) ?? null;
}
