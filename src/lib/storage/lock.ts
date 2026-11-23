// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * One owner tab per stored plan (phase-4.md 7.1, 8.1 #7): store-types.ts `AcquirePlanFn` over Web
 * Locks, one exclusive lock per plan (`mainspring.plan.<id>`), held for as long as the tab has the
 * plan open.
 *
 * - **A second tab** asks with `ifAvailable`: the plan is `held-elsewhere` while another tab holds it.
 * - **"Open here instead"** (`steal`) first asks the owner, on a BroadcastChannel, to hand the plan
 *   over, and waits in the lock's queue. The owner runs its `onAsked` hook (the app flushes
 *   autosave, so the newest text is stored), lets go and resolves `lost`: it shows the plan
 *   read-only from then on. The asking tab is granted the lock and reads the store, which has that
 *   text. An owner that does not let go within `HANDOVER_MS` (a frozen background tab) loses the
 *   lock by force (`steal: true`); its `lost` resolves when it runs again, and it writes nothing
 *   after that.
 * - **No Web Locks** (an old browser): the lock is granted and never lost, as the contract says.
 *
 * `acquire` returns a `HeldLock`, a `PlanLock` with the `onAsked` hook; it is an `AcquirePlanFn`.
 */
import type { AcquirePlanFn, PlanLock } from './store-types';
import type { WorkspaceId } from './types';

/** How long "Open here instead" waits for the owner to hand over before it takes the lock. */
export const HANDOVER_MS = 3000;
const CHANNEL = 'mainspring.plans';

export interface HeldLock extends PlanLock {
	/**
	 * What to finish before the plan is handed to a tab that asked for it (flushing autosave). The
	 * lock is let go when it settles, or after `HANDOVER_MS` at the latest.
	 */
	onAsked(f: () => Promise<unknown>): void;
}

export interface LockDeps {
	/** Default `navigator.locks`; null for a browser without Web Locks. */
	readonly locks?: LockManager | null;
	readonly channel?: () => BroadcastChannel | null;
	/** Default `HANDOVER_MS`. */
	readonly handoverMs?: number;
}

const never = new Promise<never>(() => undefined);
const free: HeldLock = { release: () => undefined, lost: never, onAsked: () => undefined };
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createAcquire(deps: LockDeps = {}) {
	const locks = 'locks' in deps ? deps.locks : (globalThis.navigator?.locks ?? null);
	const channel =
		deps.channel ??
		(() => (typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null));
	const ms = deps.handoverMs ?? HANDOVER_MS;
	return (
		id: WorkspaceId,
		o?: { readonly steal?: boolean },
	): Promise<HeldLock | 'held-elsewhere'> =>
		new Promise((resolve) => {
			if (!locks) return resolve(free);
			const name = `mainspring.plan.${id}`;
			let letGo!: () => void;
			let lose!: () => void;
			const held = new Promise<void>((r) => (letGo = r));
			const lost = new Promise<void>((r) => (lose = r));
			/** Granted, then let go (released or handed over): nothing more to do. */
			let granted = false;
			let done = false;
			let asked: () => Promise<unknown> = () => Promise.resolve();
			let timer: ReturnType<typeof setTimeout> | undefined;
			const bc = channel();
			const end = (): void => {
				done = true;
				letGo();
				bc?.close();
			};
			if (bc)
				bc.onmessage = (e: MessageEvent<unknown>) => {
					if (!granted || done || e.data !== id) return;
					done = true;
					void Promise.race([asked().catch(() => undefined), wait(ms)]).then(() => {
						lose();
						end();
					});
				};
			const lock: HeldLock = { release: end, lost, onAsked: (f) => (asked = f) };
			const take = (opts: LockOptions, onFail: () => void): void => {
				locks
					.request(name, opts, (l) => {
						if (!l) {
							bc?.close();
							resolve('held-elsewhere');
							return;
						}
						granted = true;
						clearTimeout(timer);
						resolve(lock);
						return held;
					})
					.catch(() => {
						if (!granted) return onFail();
						// Taken by force: this tab must not write the plan any more.
						if (!done) lose();
						end();
					});
			};
			if (!o?.steal) return take({ ifAvailable: true }, () => resolve('held-elsewhere'));
			// Ask the owner first; take the lock by force if it has not let go in time.
			const ask = channel();
			ask?.postMessage(id);
			ask?.close();
			const ctl = new AbortController();
			timer = setTimeout(() => ctl.abort(), ms);
			take({ signal: ctl.signal }, () => take({ steal: true }, () => resolve('held-elsewhere')));
		});
}

/** lock.ts's `AcquirePlanFn` (store-types.ts), on this browser's Web Locks. */
export const acquire = createAcquire() satisfies AcquirePlanFn;
