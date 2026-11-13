// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The edit-intent timing cases of phase-2.md T6 (audit §2.1): every `EditIntent` type on the
 * Fedora 20 plan, built with the engine's hints as the app builds it, and the Gantt drop path
 * (`checkAction`: planAction and the dry run) for the 7.1 rows.
 *
 * Fedora declares no resources, leaves or allocations, so the resource, allocation and leave
 * intents run on "Fedora+res": Fedora with a global leave, a resource group of two people (one
 * with a leave) after the project block, and `allocate dev` in one leaf. The hints are mapped
 * through that insertion, so the macro-built tasks keep their ids. Every case reports its status
 * (edit, noop or refused); the table in the gate lists them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ChangeSet, Text } from '@codemirror/state';
import { createTimeZoneHost } from '../../src/engine/timezone';
import type { ScheduleResult } from '../../src/engine/protocol';
import { checkAction, type ActionContext, type GanttAction } from '../../src/lib/gantt/intents';
import { resolveLinks } from '../../src/lib/gantt/links';
import { analyseResult } from '../../src/lib/schedule/critical';
import { finishScenario } from '../../src/lib/schedule/finish';
import { workingTimeOf } from '../../src/lib/schedule/working-time';
import { applyIntent } from '../../src/lib/tjp/edit/apply';
import type { EditIntent } from '../../src/lib/tjp/edit/types';
import {
	buildIndex,
	hintsFromResult,
	type EngineHints,
	type SymbolIndex,
} from '../../src/lib/tjp/index';
import { golden } from '../../src/lib/tjp/index/testing';
import { createWorkspace, type WorkspaceSnapshot } from '../../src/lib/workspace/workspace';
import { ROOT } from '../grammar/corpus';

/** Timed runs per case, after three warm-ups (the audit used 8, too few for a p90). */
export const INTENT_RUNS = Number(process.env['INTENT_TIMING_RUNS'] ?? 30);

export interface TimingCase {
	readonly name: string;
	readonly plan: 'Fedora' | 'Fedora+res' | 'scale-1000';
	/**
	 * A run on a fresh workspace and index (built here, outside the timing), so no cache of an
	 * earlier run helps: every edit in the app starts from a new snapshot. Returns the status.
	 */
	prepare(): () => string;
}

const ENTRY = 'f-20.tjp';
const RESOURCES =
	'\nleaves holiday "Independence Day" 2013-07-04\n' +
	'resource team "Team" {\n' +
	'  resource dev "Developer" {\n' +
	'    efficiency 1.0\n' +
	'    leaves annual 2013-08-05 - 2013-08-09\n' +
	'  }\n' +
	'  resource qa "Tester"\n' +
	'}\n';

function result(): ScheduleResult {
	const file = path.join(ROOT, 'engine/golden/expected/upstream-fedora-20.json');
	return (JSON.parse(fs.readFileSync(file, 'utf8')) as { result: ScheduleResult }).result;
}

interface Plan {
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
	/** The same plan parsed and indexed again, sharing nothing with this one. */
	fresh(): Plan;
}

function planOf(
	files: Record<string, string>,
	entry: string,
	hints: EngineHints | undefined,
): Plan {
	const snap = createWorkspace({ entry, files }).snapshot();
	return {
		snap,
		index: buildIndex(snap, hints, { cache: null }),
		fresh: () => planOf(files, entry, hints),
	};
}

function textsOf(snap: WorkspaceSnapshot): Record<string, string> {
	const files: Record<string, string> = {};
	for (const [p, f] of snap.files) files[p] = f.text.toString();
	return files;
}

function fedora(r: ScheduleResult): Plan {
	const snap = golden('upstream-fedora-20').snapshot();
	return planOf(
		textsOf(snap),
		snap.entry,
		hintsFromResult(r, (_f, l) => l),
	);
}

/** Fedora with resources, leaves and one allocation (module comment). */
function withResources(base: Plan, r: ScheduleResult, leaf: string): Plan {
	const files = textsOf(base.snap);
	const text = files[ENTRY] ?? '';
	const afterProject = text.indexOf('\n}\n', text.indexOf('\nproject ')) + 3;
	const body = base.index.tasks.get(leaf)?.decl.body;
	if (afterProject < 3 || !body) throw new Error('Fedora shape');
	const changes = ChangeSet.of(
		[
			{ from: afterProject, insert: RESOURCES },
			{ from: body.from + 1, insert: '\n    allocate dev' },
		],
		text.length,
	);
	const before = Text.of(text.split('\n'));
	const after = changes.apply(before);
	files[ENTRY] = after.toString();
	const mapLine = (f: string, l: number): number | null =>
		f !== ENTRY
			? l
			: l > before.lines
				? null
				: after.lineAt(changes.mapPos(before.line(l).from, 1)).number;
	return planOf(files, ENTRY, hintsFromResult(r, mapLine));
}

/** 'edit', 'noop already-set' or 'refused cycle'. */
const statusOf = (r: { status: string; reason?: string }): string =>
	r.reason === undefined ? r.status : `${r.status} ${r.reason}`;

function intentCase(
	name: string,
	plan: TimingCase['plan'],
	p: Plan,
	intent: EditIntent,
): TimingCase {
	return {
		name,
		plan,
		prepare: () => {
			const f = p.fresh();
			return () => statusOf(applyIntent(f.snap, f.index, intent));
		},
	};
}

function ganttCase(name: string, p: Plan, ctx: ActionContext, a: GanttAction): TimingCase {
	return {
		name,
		plan: 'Fedora',
		prepare: () => {
			const f = p.fresh();
			const fresh = { ...ctx, index: f.index };
			return () => statusOf(checkAction(a, fresh, f.snap));
		},
	};
}

export function fedoraCases(): TimingCase[] {
	const r = result();
	const fed = fedora(r);
	const tasks = [...fed.index.tasks.values()];
	const leaves = tasks.filter((t) => t.children.length === 0 && t.parent && !t.expandedOnly);
	const [a, b, c] = leaves;
	const parent = tasks.find((t) => t.children.length > 2 && !t.expandedOnly);
	// A parent other than the leaf's own, so that the move is real.
	const other = tasks.find((t) => t.children.length > 2 && !t.expandedOnly && t.id !== a?.parent);
	const dep = fed.index.dependencies.find((d) => d.pred && d.succ && d.site === 'decl');
	const flagged = tasks.find((t) => !t.expandedOnly && t.attrs.some((x) => x.keyword === 'flags'));
	if (!dep?.succ || !dep.pred || !parent || !other || !a || !b || !c || !flagged) {
		throw new Error('Fedora shape');
	}
	const sized = leaves.find((t) =>
		t.attrs.some((x) => x.keyword === 'length' || x.keyword === 'duration'),
	);
	if (!sized) throw new Error('Fedora shape');
	const res = withResources(fed, r, a.id);
	const leave = (scope: 'global' | 'resource') =>
		res.index.leaves.find((l) => (scope === 'global') === (l.scope.kind === 'global'))?.items[0];
	const globalLeave = leave('global');
	const devLeave = leave('resource');
	if (!globalLeave || !devLeave || !res.index.resources.has('dev'))
		throw new Error('Fedora+res shape');

	const F = (name: string, i: EditIntent) => intentCase(name, 'Fedora', fed, i);
	const R = (name: string, i: EditIntent) => intentCase(name, 'Fedora+res', res, i);
	// Fedora's project header is built by macros, so its project intents are text-only: they run
	// on the 1,000-task plan instead, which is larger.
	const scaleSnap = golden('syn-20-scale-1000').snapshot();
	const scale = planOf(textsOf(scaleSnap), scaleSnap.entry, undefined);
	const S = (name: string, i: EditIntent) => intentCase(name, 'scale-1000', scale, i);
	const cases: TimingCase[] = [
		F('setAttr priority', { type: 'setAttr', task: a.id, attr: 'priority', value: '700' }),
		F('setAttr length', { type: 'setAttr', task: a.id, attr: 'length', value: '3d' }),
		F('setAttr start', { type: 'setAttr', task: a.id, attr: 'start', value: '2013-06-03' }),
		F('setAttr complete', { type: 'setAttr', task: a.id, attr: 'complete', value: '40' }),
		F('removeAttr flags', { type: 'removeAttr', task: flagged.id, attr: 'flags' }),
		F('renameTask', { type: 'renameTask', task: a.id, name: 'Renamed task' }),
		F('addTask', { type: 'addTask', parent: parent.id, index: 0, name: 'New task' }),
		F('deleteTask', { type: 'deleteTask', task: c.id }),
		F('moveTask', { type: 'moveTask', task: a.id, parent: other.id, index: 0 }),
		F('addDepends', { type: 'addDepends', task: b.id, target: c.id }),
		F('removeDepends', { type: 'removeDepends', task: dep.succ, target: dep.pred }),
		F('setDependsGap', {
			type: 'setDependsGap',
			task: dep.succ,
			target: dep.pred,
			gap: { kind: 'gaplength', value: '2d' },
		}),
		F('declareFlag', { type: 'declareFlag', flag: 'perf' }),
		F('format', { type: 'format', file: ENTRY }),
		S('setProjectHeader', { type: 'setProjectHeader', name: 'Scale' }),
		S('setProjectAttr', { type: 'setProjectAttr', attr: 'now', value: '2026-03-09' }),
		S('removeProjectAttr', { type: 'removeProjectAttr', attr: 'now' }),
		S('setWorkingHours', {
			type: 'setWorkingHours',
			scope: { kind: 'project' },
			days: ['mon'],
			hours: [['8:00', '16:00']],
		}),
		R('allocate', { type: 'allocate', task: sized.id, resources: ['dev', 'qa'] }),
		R('addAllocation', { type: 'addAllocation', task: a.id, resource: 'qa' }),
		R('removeAllocation', { type: 'removeAllocation', task: a.id, resource: 'dev' }),
		R('replaceAllocation', { type: 'replaceAllocation', task: a.id, from: 'dev', to: 'qa' }),
		R('addResource', { type: 'addResource', parent: 'team', index: 2, name: 'Writer' }),
		R('deleteResource', { type: 'deleteResource', resource: 'qa' }),
		R('moveResource', { type: 'moveResource', resource: 'qa', parent: null, index: 0 }),
		R('renameResource', { type: 'renameResource', resource: 'dev', name: 'Engineer' }),
		R('setResourceAttr', {
			type: 'setResourceAttr',
			resource: 'dev',
			attr: 'efficiency',
			value: '0.8',
		}),
		R('removeResourceAttr', { type: 'removeResourceAttr', resource: 'dev', attr: 'efficiency' }),
		R('addLeave', {
			type: 'addLeave',
			scope: { kind: 'resource', resource: 'qa' },
			leave: { type: 'sick', start: '2013-09-02' },
		}),
		R('updateLeave', {
			type: 'updateLeave',
			leave: { item: devLeave },
			to: { type: 'annual', start: '2013-08-12', end: '2013-08-16' },
		}),
		R('removeLeave', { type: 'removeLeave', leave: { item: globalLeave } }),
	];

	// The Gantt drop path (7.3: planAction, then applyIntent, at most 50 ms on Fedora).
	const zones = createTimeZoneHost();
	const project = r.project;
	if (!project) throw new Error('Fedora has no project');
	const index = fed.index;
	const links = resolveLinks({
		sites: index.dependencies,
		result: r,
		scenario: finishScenario(r),
		current: true,
	});
	const link = links.find((l) => l.state === 'declared');
	const ctx: ActionContext = {
		index,
		result: r,
		analysis: analyseResult(r, zones),
		wt: workingTimeOf(project, zones),
		zones,
		move: { kind: 'start' },
	};
	const end = r.tasks.find((t) => t.id === sized.id)?.scenarios['plan']?.end ?? null;
	if (end === null || !link) throw new Error('Fedora shape');
	cases.push(
		ganttCase('gantt resize (R1)', fed, ctx, {
			type: 'resize',
			task: sized.id,
			end: end + 2 * 1440,
		}),
		ganttCase('gantt move, start (R2)', fed, ctx, { type: 'move', task: a.id, days: 3 }),
		ganttCase(
			'gantt move, gap (R2)',
			fed,
			{ ...ctx, move: { kind: 'gap' } },
			{ type: 'move', task: dep.succ, days: 2 },
		),
		ganttCase('gantt link (R3)', fed, ctx, { type: 'link', pred: c.id, succ: b.id }),
		ganttCase('gantt unlink (R4)', fed, ctx, { type: 'unlink', link }),
		ganttCase('gantt reorder (R5)', fed, ctx, {
			type: 'reorder',
			task: a.id,
			parent: other.id,
			index: 0,
		}),
		ganttCase('gantt progress (R9)', fed, ctx, { type: 'progress', task: sized.id, percent: 50 }),
	);
	return cases;
}
