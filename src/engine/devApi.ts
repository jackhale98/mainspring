// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The small window API of the /dev/engine test page (built only with MAINSPRING_DEV_PAGES=1).
 * Playwright tests call it through `page.evaluate`; nothing in the app uses it.
 */
import type { EngineClient, EngineState, ScheduleOutcome } from './client';
import type { EngineVersions, ScheduleRequest } from './protocol';

export interface DevEngineApi {
	/** Resolves once the worker is ready. */
	ready(): Promise<EngineVersions>;
	/** Schedules through the real worker; `request.revision` must increase between calls. */
	schedule(request: ScheduleRequest): Promise<ScheduleOutcome>;
	/** Null until the worker is ready. */
	versions(): EngineVersions | null;
	state(): EngineState;
}

declare global {
	interface Window {
		mainspringDev?: DevEngineApi;
	}
}

/** Wraps a client in the window API and keeps the versions once known. */
export function createDevApi(client: EngineClient): DevEngineApi {
	let versions: EngineVersions | null = null;
	const ready = client.ready().then((v) => {
		versions = v;
		return v;
	});
	ready.catch(() => undefined);
	return {
		ready: () => ready,
		schedule: (request) => client.schedule(request),
		versions: () => versions,
		state: () => client.state,
	};
}
