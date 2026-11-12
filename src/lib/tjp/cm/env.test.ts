// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createWorkspace, type Workspace } from '../../workspace/workspace';
import { buildIndex } from '../index/build';
import { NO_HINTS } from '../index/hints';
import type { SymbolIndex } from '../index/types';
import { currentIndex, envOf, tjpEnv, workspaceFile } from './env';
import { workspaceExtensions } from './index';
import { PLAN, TABLE_ONLY, tjpState } from './testing';

describe('tjpEnv', () => {
	it('fills defaults: no workspace, no index, ids on (ADR-0004)', () => {
		const env = envOf({ top: 'project', docs: () => TABLE_ONLY });
		expect(env).toMatchObject({ top: 'project', path: '', ids: true });
		expect(env.workspace()).toBeNull();
		expect(env.index()).toBeNull();
		expect(tjpState('x').facet(tjpEnv).top).toBe('global');
	});
});

describe('workspaceFile and currentIndex', () => {
	let ws: Workspace | null = null;
	let index: SymbolIndex | null = null;
	ws = createWorkspace(
		{ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } },
		{
			extensions: workspaceExtensions({
				docs: () => TABLE_ONLY,
				workspace: () => ws,
				index: () => index,
			}),
		},
	);
	const workspace = ws;

	it('give the workspace file and index only while they match the editor text', () => {
		const s = workspace.state('plan.tjp');
		expect(workspaceFile(s)?.path).toBe('plan.tjp');
		expect(currentIndex(s)).toBeNull();
		index = buildIndex(workspace.snapshot(), NO_HINTS);
		expect(currentIndex(s)).toBe(index);
		// An editor state ahead of the workspace (not committed yet).
		const ahead = s.update({ changes: { from: 0, insert: '#\n' } }).state;
		expect(workspaceFile(ahead)).toBeNull();
		expect(currentIndex(ahead)).toBeNull();
		workspace.commit('plan.tjp', s.update({ changes: { from: 0, insert: '#\n' } }), 'typing');
		const now = workspace.state('plan.tjp');
		expect(workspaceFile(now)).not.toBeNull();
		expect(currentIndex(now)).toBeNull();
	});

	it('are null outside a workspace', () => {
		const s = tjpState(PLAN);
		expect(workspaceFile(s)).toBeNull();
		expect(currentIndex(s)).toBeNull();
	});
});
