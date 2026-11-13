// SPDX-License-Identifier: GPL-2.0-or-later
// Is a newer build deployed? (ADR-0012.) The build writes `version.json` beside the pages with its
// id, and the running app carries the same id. The app asks for that file past every cache and
// compares. Checks run soon after start, when the tab comes back into view, and every few minutes.
// In Phase 4 the service worker's update uses the same signal.

export interface BuildInfo {
	/** The commit and build time, e.g. "3f2a91bc-202611131402"; "dev" on a dev server. */
	readonly id: string;
	/** ISO time of the build; empty on a dev server. */
	readonly builtAt: string;
}

export type CheckResult = 'current' | 'available' | 'unknown';

type Fetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>;

/** Reads the deployed build id, or null when it cannot be read (offline, an old deploy). */
export async function latestBuild(
	fetchFn: Fetch,
	url: string,
	now: number,
): Promise<string | null> {
	try {
		const sep = url.includes('?') ? '&' : '?';
		const res = await fetchFn(`${url}${sep}t=${now}`, { cache: 'no-store' });
		if (!res.ok) return null;
		const body: unknown = await res.json();
		if (typeof body !== 'object' || body === null || !('id' in body)) return null;
		const id = (body as { id: unknown }).id;
		return typeof id === 'string' && id.length > 0 ? id : null;
	} catch {
		return null;
	}
}

/** What a check found: a different deployed id means a newer build (deploys only move forward). */
export function compareBuild(current: string, latest: string | null): CheckResult {
	if (latest === null) return 'unknown';
	return latest === current ? 'current' : 'available';
}

export interface WatchOptions {
	readonly current: BuildInfo;
	readonly url: string;
	readonly fetch: Fetch;
	readonly onResult: (result: CheckResult) => void;
	/** Fires `visibilitychange`; usually `document`. */
	readonly visibility?:
		Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | undefined;
	readonly firstDelayMs?: number | undefined;
	readonly intervalMs?: number | undefined;
	/** At most one check per this many ms when the tab comes back into view. */
	readonly minGapMs?: number | undefined;
	readonly now?: (() => number) | undefined;
	readonly timers?:
		| Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'>
		| undefined;
}

export const FIRST_CHECK_MS = 3_000;
export const CHECK_INTERVAL_MS = 10 * 60_000;
export const MIN_GAP_MS = 60_000;

/**
 * Checks on a schedule and reports each result. Returns `check` (ask now) and `stop`. A dev build
 * never checks. Once a newer build is found it stops asking: the answer cannot change back.
 */
export function watchForUpdates(o: WatchOptions): {
	check: () => Promise<CheckResult>;
	stop: () => void;
} {
	const t = o.timers ?? globalThis;
	const now = o.now ?? Date.now;
	let last = -Infinity;
	let found = false;
	let stopped = false;
	const check = async (): Promise<CheckResult> => {
		if (o.current.id === 'dev') return 'unknown';
		if (found) return 'available';
		last = now();
		const result = compareBuild(o.current.id, await latestBuild(o.fetch, o.url, last));
		if (stopped) return result;
		if (result === 'available') found = true;
		o.onResult(result);
		return result;
	};
	if (o.current.id === 'dev') return { check, stop: () => undefined };
	const first = t.setTimeout(() => void check(), o.firstDelayMs ?? FIRST_CHECK_MS);
	const every = t.setInterval(() => void check(), o.intervalMs ?? CHECK_INTERVAL_MS);
	const onVisible = (): void => {
		if (o.visibility?.visibilityState !== 'visible') return;
		if (now() - last < (o.minGapMs ?? MIN_GAP_MS)) return;
		void check();
	};
	o.visibility?.addEventListener('visibilitychange', onVisible);
	return {
		check,
		stop: () => {
			stopped = true;
			t.clearTimeout(first);
			t.clearInterval(every);
			o.visibility?.removeEventListener('visibilitychange', onVisible);
		},
	};
}

/**
 * Reloads onto the newest build. The page itself is fetched past the HTTP cache first, so the
 * reload cannot be answered with the cached copy; the other files have hashed names.
 */
export async function reloadToLatest(
	loc: Pick<Location, 'href' | 'reload'>,
	fetchFn: Fetch,
): Promise<void> {
	try {
		await fetchFn(loc.href, { cache: 'reload' });
	} catch {
		// Offline: the plain reload below still does its best.
	}
	loc.reload();
}
