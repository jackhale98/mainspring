// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for intents.ts: the gantt-manipulation fixture (tests/fixtures/gantt/manipulation,
 * phase-2.md 7.1) with its committed golden result, the index built with the engine's hints (as
 * the app builds it), the driving analysis, the working time and the drawn links, plus a way to
 * see the files after an action.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ScheduleResult } from '../../engine/protocol';
import { ROOT } from '../../../tests/grammar/corpus';
import { analyseResult } from '../schedule/critical';
import { workingTimeOf } from '../schedule/working-time';
import { buildIndex, hintsFromResult, type SymbolIndex } from '../tjp/index';
import { golden } from '../tjp/index/testing';
import type { EditOptions } from '../tjp/edit/types';
import { createWorkspace, type WorkspaceSnapshot } from '../workspace/workspace';
import { checkAction, type ActionContext, type ActionOutcome, type GanttAction } from './intents';
import { resolveLinks } from './links';
import { finishScenario } from '../schedule/finish';
import type { RawLink } from './model';

export const FIXTURE = 'gantt-manipulation';

export interface Fixture {
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
	readonly result: ScheduleResult;
	readonly links: readonly RawLink[];
	ctx(over?: Partial<ActionContext>): ActionContext;
	/** The original text of a file. */
	text(file: string): string;
}

export function goldenResult(id: string): ScheduleResult {
	const g = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${id}.json`), 'utf8'),
	) as { result: ScheduleResult };
	return g.result;
}

/** A fixture from files and a result (the golden one, or one the engine just made). */
export function fixtureFrom(
	files: Record<string, string>,
	entry: string,
	result: ScheduleResult,
): Fixture {
	const snap = createWorkspace({ entry, files }).snapshot();
	const index = buildIndex(
		snap,
		hintsFromResult(result, (_f, l) => l),
		{ cache: null },
	);
	const analysis = analyseResult(result);
	const wt = result.project ? workingTimeOf(result.project) : null;
	const links = resolveLinks({
		sites: index.dependencies,
		result,
		scenario: finishScenario(result),
		current: true,
	});
	return {
		snap,
		index,
		result,
		links,
		ctx: (over = {}) => ({ index, result, analysis, wt, move: null, ...over }),
		text: (file) => {
			const f = snap.files.get(file);
			if (!f) throw new Error(`no file ${file}`);
			return f.text.toString();
		},
	};
}

export function manipulation(): Fixture {
	const ws = golden(FIXTURE).snapshot();
	const files: Record<string, string> = {};
	for (const [p, f] of ws.files) files[p] = f.text.toString();
	return fixtureFrom(files, ws.entry, goldenResult(FIXTURE));
}

/** Every file after an action that must give an edit (unchanged files as they were). */
export function filesAfter(
	fx: Fixture,
	a: GanttAction,
	over: Partial<ActionContext> = {},
	opts: EditOptions = {},
): Record<string, string> {
	const out = checkAction(a, fx.ctx(over), fx.snap, opts);
	if (out.status !== 'edit') throw new Error(`expected an edit, got ${JSON.stringify(brief(out))}`);
	const files: Record<string, string> = {};
	for (const [p, f] of fx.snap.files) {
		const cs = out.edit.changes[p];
		files[p] = cs ? cs.apply(f.text).toString() : f.text.toString();
	}
	return files;
}

/** An outcome without the edit object, for messages and snapshots. */
export function brief(out: ActionOutcome): unknown {
	return out.status === 'edit' ? { status: 'edit', intent: out.intent, label: out.label } : out;
}

/** `text` with `from` replaced by `to`, exactly once (the hand-written expected patch). */
export function patched(text: string, from: string, to: string): string {
	const at = text.indexOf(from);
	if (at < 0 || text.indexOf(from, at + 1) >= 0) {
		throw new Error(`expected exactly one ${JSON.stringify(from)}`);
	}
	return text.slice(0, at) + to + text.slice(at + from.length);
}
