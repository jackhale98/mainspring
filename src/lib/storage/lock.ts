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
 *   lock by force (`steal: true`); its `lost` resolves when it runs again, and the store refuses
 *   its writes from then on (local-store.ts, the owner epoch).
 * - **Messages** carry the plan id and the sender's nonce, one per `acquire`: a lock never answers
 *   its own messages, so a tab that takes a plan back cannot hand it to itself (T4 review M4).
 * - **No Web Locks** (an old browser): the same channel stands in (T4 review L3). A tab asks "who
 *   has this plan?" and waits `WHO_MS` for an owner to answer; with no answer it holds the plan.
 *   "Open here instead" asks the owner to hand over and waits for its "gone" (at most
 *   `HANDOVER_MS`). Without BroadcastChannel either, the lock is granted and never lost.
 *
 * `acquire` returns a `HeldLock`, a `PlanLock` with the `onAsked` hook; it is an `AcquirePlanFn`.
 */
import type { AcquirePlanFn, PlanLock } from './store-types';
import type { WorkspaceId } from './types';

/** How long "Open here instead" waits for the owner to hand over before it takes the lock. */
export const HANDOVER_MS = 3000;
/** Without Web Locks: how long a tab waits for an owner to say that it has the plan. */
export const WHO_MS = 150;
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
	/** Default `WHO_MS`. */
	readonly whoMs?: number;
}

/** A message on the channel: `ask` to hand over, `who` has it, `mine`, and `gone` once handed. */
interface Message {
	readonly k: 'ask' | 'who' | 'mine' | 'gone';
	readonly id: string;
	/** The sender's nonce (module comment). */
	readonly n: string;
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
	const whoMs = deps.whoMs ?? WHO_MS;
	return (
		id: WorkspaceId,
		o?: { readonly steal?: boolean },
	): Promise<HeldLock | 'held-elsewhere'> =>
		new Promise((resolve) => {
			const bc = channel();
			if (!locks && !bc) return resolve(free);
			const n = crypto.randomUUID();
			const name = `mainspring.plan.${id}`;
			let letGo!: () => void;
			let lose!: () => void;
			const held = new Promise<void>((r) => (letGo = r));
			const lost = new Promise<void>((r) => (lose = r));
			/** Holds the plan now (granted, and not let go). */
			let granted = false;
			let done = false;
			let asked: () => Promise<unknown> = () => Promise.resolve();
			let timer: ReturnType<typeof setTimeout> | undefined;
			/** Waits for an answer of another tab (no Web Locks): `mine` or `gone`. */
			let heard: ((k: Message['k']) => void) | null = null;
			const send = (k: Message['k']): void => bc?.postMessage({ k, id, n } satisfies Message);
			const finish = (handed: boolean): void => {
				if (handed) {
					send('gone');
					lose();
				}
				letGo();
				bc?.close();
			};
			if (bc)
				bc.onmessage = (e: MessageEvent<Message | null>) => {
					const m = e.data;
					if (!m || m.id !== id || m.n === n) return;
					if (m.k === 'mine' || m.k === 'gone') return heard?.(m.k);
					if (!granted || done) return;
					if (m.k === 'who') return send('mine');
					done = true;
					void Promise.race([asked().catch(() => undefined), wait(ms)]).then(() => finish(true));
				};
			const lock: HeldLock = {
				release: () => {
					if (done) return;
					done = true;
					finish(false);
				},
				lost,
				onAsked: (f) => (asked = f),
			};
			const grant = (): void => {
				granted = true;
				clearTimeout(timer);
				resolve(lock);
			};
			const refuse = (): void => {
				bc?.close();
				resolve('held-elsewhere');
			};
			if (o?.steal) send('ask');
			if (!locks) {
				// No Web Locks: the channel stands in (module comment).
				const answer = (k: Message['k'], within: number): Promise<boolean> =>
					new Promise((r) => {
						heard = (got) => got === k && r(true);
						setTimeout(() => r(false), within);
					});
				if (o?.steal) void answer('gone', ms).then(grant);
				else {
					send('who');
					void answer('mine', whoMs).then((taken) => (taken ? refuse() : grant()));
				}
				return;
			}
			const take = (opts: LockOptions, onFail: () => void): void => {
				locks
					.request(name, opts, (l) => {
						if (!l) return refuse();
						grant();
						return held;
					})
					.catch(() => {
						if (!granted) return onFail();
						// Taken by force: this tab must not write the plan any more.
						if (!done) lose();
						done = true;
						letGo();
						bc?.close();
					});
			};
			if (!o?.steal) return take({ ifAvailable: true }, refuse);
			// The owner was asked; take the lock by force if it has not let go in time.
			const ctl = new AbortController();
			timer = setTimeout(() => ctl.abort(), ms);
			take({ signal: ctl.signal }, () => take({ steal: true }, refuse));
		});
}

/** lock.ts's `AcquirePlanFn` (store-types.ts), on this browser's Web Locks. */
export const acquire = createAcquire() satisfies AcquirePlanFn;
