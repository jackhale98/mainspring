// SPDX-License-Identifier: GPL-2.0-or-later
// Whether a newer build is deployed, for the status strip and the engine popover (ADR-0012).
import { BUILD } from '../app/build';
import { strings } from '../strings';
import {
	reloadToLatest,
	watchForUpdates,
	type BuildInfo,
	type CheckResult,
	type WatchOptions,
} from '../app/update-check';

type Fetch = WatchOptions['fetch'];

export interface AppUpdatesOptions {
	readonly build?: BuildInfo;
	readonly url: string;
	readonly fetch?: Fetch;
	readonly visibility?: WatchOptions['visibility'];
	readonly location?: Pick<Location, 'href' | 'reload'>;
	readonly firstDelayMs?: number;
}

export class AppUpdates {
	/** 'available' once a newer build is deployed; 'current' when checked and up to date. */
	status = $state<CheckResult>('unknown');
	checking = $state(false);
	readonly build: BuildInfo;
	readonly #opts: AppUpdatesOptions;
	readonly #fetch: Fetch;
	#watch: ReturnType<typeof watchForUpdates> | null = null;

	constructor(opts: AppUpdatesOptions) {
		this.#opts = opts;
		this.build = opts.build ?? BUILD;
		this.#fetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
	}

	start(): void {
		this.#watch ??= watchForUpdates({
			current: this.build,
			url: this.#opts.url,
			fetch: this.#fetch,
			visibility: this.#opts.visibility,
			firstDelayMs: this.#opts.firstDelayMs,
			onResult: (r) => (this.status = r),
		});
	}

	stop(): void {
		this.#watch?.stop();
		this.#watch = null;
	}

	/** Asks now (the popover's "Check for updates"). */
	async checkNow(): Promise<CheckResult> {
		this.start();
		this.checking = true;
		try {
			const r = (await this.#watch?.check()) ?? 'unknown';
			this.status = r;
			return r;
		} finally {
			this.checking = false;
		}
	}

	/**
	 * Reloads onto the newest build. `confirmLoss` is asked first when there are unsaved changes,
	 * and a "no" keeps the page. Returns whether it reloaded.
	 */
	async reload(unsaved: boolean, confirmLoss: () => boolean): Promise<boolean> {
		if (unsaved && !confirmLoss()) return false;
		await reloadToLatest(this.#opts.location ?? globalThis.location, this.#fetch);
		return true;
	}

	/** `reload` with the app's own question; every Reload button calls this. */
	reloadAsking(unsaved: boolean): Promise<boolean> {
		return this.reload(unsaved, () => globalThis.confirm(strings.update.confirmReload));
	}
}
