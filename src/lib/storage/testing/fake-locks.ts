// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A Web Locks manager for tests (exclusive locks only), shared by the "tabs" of a test the way one
 * browser shares `navigator.locks` between its tabs. It follows the spec where lock.ts relies on
 * it: `ifAvailable` calls back with null while the lock is held; a plain request waits in the
 * queue and is dropped with an AbortError when its `signal` aborts; `steal` takes the lock at once,
 * and the holder's request then rejects with an AbortError; a lock is held until the callback's
 * promise settles.
 */
interface Holder {
	readonly drop: (e: unknown) => void;
}

export class FakeLocks {
	readonly #held = new Map<string, Holder>();
	readonly #queue = new Map<string, Array<() => void>>();

	/** Whether someone holds `name` now. */
	isHeld(name: string): boolean {
		return this.#held.has(name);
	}

	request(
		name: string,
		a: LockOptions | LockGrantedCallback<unknown>,
		b?: LockGrantedCallback<unknown>,
	): Promise<unknown> {
		const opts: LockOptions = typeof a === 'function' ? {} : a;
		const cb = (typeof a === 'function' ? a : b) as LockGrantedCallback<unknown>;
		return new Promise((resolve, reject) => {
			const grant = (): void => {
				let done = false;
				const holder: Holder = {
					drop: (e) => {
						if (done) return;
						done = true;
						reject(e);
					},
				};
				this.#held.set(name, holder);
				const settle = (): void => {
					if (this.#held.get(name) !== holder) return;
					this.#held.delete(name);
					this.#queue.get(name)?.shift()?.();
				};
				Promise.resolve()
					.then(() => cb({ name, mode: 'exclusive' } as Lock))
					.then(
						(v) => {
							settle();
							if (!done) ((done = true), resolve(v));
						},
						(e) => {
							settle();
							if (!done) ((done = true), reject(e));
						},
					);
			};
			if (opts.steal) {
				this.#held.get(name)?.drop(new DOMException('stolen', 'AbortError'));
				this.#held.delete(name);
				return grant();
			}
			if (!this.#held.has(name)) return grant();
			if (opts.ifAvailable) {
				Promise.resolve()
					.then(() => cb(null))
					.then(resolve, reject);
				return;
			}
			const q = this.#queue.get(name) ?? [];
			this.#queue.set(name, q);
			const wait = (): void => grant();
			q.push(wait);
			opts.signal?.addEventListener('abort', () => {
				const i = q.indexOf(wait);
				if (i < 0) return;
				q.splice(i, 1);
				reject(new DOMException('aborted', 'AbortError'));
			});
		});
	}

	query(): Promise<LockManagerSnapshot> {
		return Promise.resolve({ held: [], pending: [] });
	}
}

/** The fake as the `LockManager` lock.ts takes. */
export function fakeLocks(): FakeLocks & LockManager {
	return new FakeLocks() as FakeLocks & LockManager;
}
