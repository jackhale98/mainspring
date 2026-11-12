// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Intl-backed time-zone host, apart from runtime.ts so that the main thread (the symbol
 * index's zone checks, src/lib/workspace) can use it without bundling the Ruby VM. runtime.ts
 * re-exports it for the worker and the Node harness. Imports nothing.
 */

/** What the bridge's tj_wasm_tz.rb calls through `JS.global[:tjTz]`. */
export interface TimeZoneHost {
	/** UTC offset in seconds of `zone` at the UTC instant `epochSeconds`. */
	offset(zone: string, epochSeconds: number): number;
	valid(zone: string): boolean;
}

/** The Intl-backed time-zone host from the PoC: WASI's libc knows only UTC. */
export function createTimeZoneHost(): TimeZoneHost {
	const formats = new Map<string, Intl.DateTimeFormat>();
	const format = (zone: string): Intl.DateTimeFormat => {
		let f = formats.get(zone);
		if (!f) {
			f = new Intl.DateTimeFormat('en-US', {
				timeZone: zone,
				hourCycle: 'h23',
				year: 'numeric',
				month: 'numeric',
				day: 'numeric',
				hour: 'numeric',
				minute: 'numeric',
				second: 'numeric',
			});
			formats.set(zone, f);
		}
		return f;
	};
	return {
		offset(zone, epochSeconds) {
			const parts: Record<string, number> = {};
			for (const p of format(zone).formatToParts(new Date(epochSeconds * 1000))) {
				parts[p.type] = Number(p.value);
			}
			const field = (name: string): number => parts[name] ?? 0;
			const asUtc = Date.UTC(
				field('year'),
				field('month') - 1,
				field('day'),
				field('hour'),
				field('minute'),
				field('second'),
			);
			return Math.round((asUtc - epochSeconds * 1000) / 1000);
		},
		valid(zone) {
			try {
				format(zone);
				return true;
			} catch {
				return false;
			}
		},
	};
}
