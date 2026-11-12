// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `buildIndex` (6.4): per-file facts, cached by `TjpFile` identity so a workspace change rescans
 * only the files it touched, then the link walk over every include visit, which is cheap and
 * runs in full each time. The result depends only on the snapshot, the hints and the zones, so
 * an index built with the cache equals one built from scratch.
 */
import type { WorkspacePath } from '../../../engine/protocol';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { TjpFile } from '../document';
import type { ZoneOffsets } from '../values';
import { ContextTracker } from './calendar';
import type { FileFacts } from './facts';
import { HintTable, NO_HINTS } from './hints';
import { Linker } from './link';
import { IndexImpl } from './query';
import { scanFile } from './scan';
import type { EngineHints, SymbolIndex } from './types';

/** Per-file facts, keyed by the file object (a new version is a new object). */
export type FactsCache = WeakMap<TjpFile, FileFacts>;

export function createFactsCache(): FactsCache {
	return new WeakMap();
}

const shared: FactsCache = createFactsCache();

export interface BuildOptions {
	/** Facts cache; null rebuilds every file. Defaults to a module-wide cache. */
	cache?: FactsCache | null;
	/** Time-zone data for the contexts of `contextAt` (the engine's TimeZoneHost). */
	zones?: ZoneOffsets;
}

export function factsOf(file: TjpFile, cache: FactsCache | null = shared): FileFacts {
	let f = cache?.get(file);
	if (!f) {
		f = scanFile(file);
		cache?.set(file, f);
	}
	return f;
}

export function buildIndex(
	ws: WorkspaceSnapshot,
	hints: EngineHints = NO_HINTS,
	opts: BuildOptions = {},
): SymbolIndex {
	const cache = opts.cache === undefined ? shared : opts.cache;
	const facts = new Map<WorkspacePath, FileFacts>();
	const get = (path: WorkspacePath): FileFacts | null => {
		let f = facts.get(path);
		if (!f) {
			const file = ws.files.get(path);
			if (!file) return null;
			f = factsOf(file, cache);
			facts.set(path, f);
		}
		return f;
	};
	const ctx = new ContextTracker(opts.zones);
	const linker = new Linker(ws, get, new HintTable(hints), ctx);
	linker.run();
	return new IndexImpl(ws, facts, linker);
}
