<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Dev page only (/dev/sync-status; see src/pages/dev/_sync-status.astro): the sync status control and
	its panel in every state, with no engine, so that the states T7 and T14 part two will reach (a
	folder or GitHub plan, queued writes, a conflict) can be seen, tested with axe and photographed
	before they exist in the app. Each row is the real control on a fake app whose `sync` is a
	controller stand-in (`status` and `location` only, what `statusOf` reads). `?wide=1` makes the bar 1400 px so that labels show; `?phone=1` draws the
	phone's control and sheet. Plain text is fine on this page: it is not user-facing.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import type { Location } from '../../lib/storage/types';
	import { storageError } from '../../lib/storage/types';
	import type { SyncStatus as Status } from '../../lib/sync/types';
	import SyncStatus from '../sync/SyncStatus.svelte';

	const wide = typeof location !== 'undefined' && new URLSearchParams(location.search).has('wide');
	const phone =
		typeof location !== 'undefined' && new URLSearchParams(location.search).has('phone');
	const NOW = Date.now();
	const GITHUB: Location = {
		kind: 'github',
		account: 'a',
		owner: 'acme',
		repo: 'plans',
		branch: 'main',
		dir: 'q4',
	};
	const FOLDER: Location = { kind: 'folder', handle: 'h', name: 'Plans' };

	interface Row {
		id: string;
		/** The control's state: a controller's status, or T4's keeping state and the tab's read-only. */
		status?: Status;
		location?: Location;
		keep?:
			| { kind: 'sample' }
			| { kind: 'stored'; at: number | null }
			| { kind: 'failed'; error: ReturnType<typeof storageError> };
		readOnly?: boolean;
	}
	const ROWS: readonly Row[] = [
		{ id: 'sample', keep: { kind: 'sample' } },
		{ id: 'browser-only', keep: { kind: 'stored', at: NOW } },
		{ id: 'browser-only-new', keep: { kind: 'stored', at: null } },
		{ id: 'saved', status: { kind: 'saved', at: NOW, revision: 'abc' }, location: FOLDER },
		{ id: 'changes', status: { kind: 'changes', files: 3 }, location: GITHUB },
		{ id: 'working', status: { kind: 'working', what: 'committing' }, location: GITHUB },
		{ id: 'checking', status: { kind: 'working', what: 'checking' }, location: GITHUB },
		{
			id: 'queued-offline',
			status: { kind: 'queued', writes: 2, why: 'offline', retryAt: null },
			location: GITHUB,
		},
		{
			id: 'queued-access',
			status: { kind: 'queued', writes: 1, why: 'needs-access', retryAt: null },
			location: GITHUB,
		},
		{
			id: 'queued-retrying',
			status: { kind: 'queued', writes: 3, why: 'retrying', retryAt: NOW + 60000 },
			location: GITHUB,
		},
		{ id: 'conflict', status: { kind: 'conflict', conflicts: 2 }, location: GITHUB },
		{ id: 'blocked', status: { kind: 'blocked', errors: 1 }, location: GITHUB },
		{ id: 'needs-access', status: { kind: 'needs-access', access: 'prompt' }, location: FOLDER },
		{ id: 'sign-in', status: { kind: 'needs-access', access: 'signed-out' }, location: GITHUB },
		{
			id: 'failed-provider',
			status: { kind: 'failed', where: 'provider', error: storageError('server', 'x') },
			location: GITHUB,
		},
		{ id: 'failed-store', keep: { kind: 'failed', error: storageError('quota', 'x') } },
		{ id: 'read-only', keep: { kind: 'stored', at: NOW }, readOnly: true },
	];

	function fake(r: Row): AppState {
		const app = $state({
			keeping: {
				keep: r.keep ?? { kind: 'stored', at: NOW },
				unopened: null,
				cleared: false,
			},
			readOnly: r.readOnly ?? false,
			heldElsewhere: null,
			storedId: 'w1',
			activeFile: 'plan.tjp',
			workspace: { texts: () => ({ 'plan.tjp': 'project p "P" 2026-01-05 +1m\n' }) },
			sync: r.status ? { status: r.status, location: r.location ?? GITHUB } : null,
			openStored: () => Promise.resolve(true),
		});
		return app as unknown as AppState;
	}
</script>

<main class="demo" data-testid="sync-demo">
	<h1>Sync status</h1>
	{#each ROWS as r (r.id)}
		<section class="row" data-row={r.id}>
			<h2>{r.id}</h2>
			<div class="bar" class:wide><SyncStatus app={fake(r)} {phone} /></div>
		</section>
	{/each}
</main>

<style>
	.demo {
		padding: 1rem;
		background: var(--color-bg);
		color: var(--color-text);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding-block: 0.25rem;
	}
	h1,
	h2 {
		margin: 0;
		font-size: 0.875rem;
	}
	h2 {
		inline-size: 11rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}
	/* The top bar's container, so that the control's label shows on a page 1360 px wide or more. */
	.bar {
		container: topbar / inline-size;
		flex: 1;
		min-inline-size: 0;
	}
	.bar.wide {
		flex: none;
		inline-size: 1400px;
	}
</style>
