// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A People view's module, fetched when the view first opens (phase-3.md 8.3, 23.1). The shell
 * (PeopleView.svelte) holds one per view so that its own chunk stays small; a view that cannot be
 * fetched (offline with nothing cached, a deploy that replaced it) reads `failed`, and `load()`
 * tries again.
 */
export class LazyModule<T> {
	module = $state.raw<T | null>(null);
	failed = $state(false);
	private loading = false;

	constructor(private readonly importer: () => Promise<T>) {}

	/** Starts the import once; a later call after a failure imports again. */
	load(): void {
		if (this.module !== null || this.loading) return;
		this.loading = true;
		this.failed = false;
		this.importer().then(
			(m) => {
				this.module = m;
				this.loading = false;
			},
			() => {
				this.failed = true;
				this.loading = false;
			},
		);
	}
}
