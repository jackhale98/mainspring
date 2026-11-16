// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the New plan sheet starts with (ADR-0013 #2): today's date in the device's calendar and the
 * device's time zone. `Intl` is used here and for the choices only (display and defaults, never
 * the schedule). The zone list is `Intl.supportedValuesOf('timeZone')`; some engines leave out
 * the zone the device is in (Chrome has no `UTC`), so that zone is added to the list. A device in
 * UTC starts on "None (UTC)", which writes no `timezone` line.
 */

/** `yyyy-mm-dd` for a date, in its local calendar. */
export function isoDate(d: Date): string {
	const p = (n: number, w = 2): string => String(n).padStart(w, '0');
	return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const UTC_NAMES: ReadonlySet<string> = new Set([
	'UTC',
	'Etc/UTC',
	'Etc/GMT',
	'GMT',
	'Etc/Universal',
]);

/** The device's zone name, or null when it is unknown or is UTC. */
export function deviceZone(): string | null {
	try {
		const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
		return zone && !UTC_NAMES.has(zone) ? zone : null;
	} catch {
		return null;
	}
}

/** The zone names to choose from, sorted, with the device's zone included. */
export function zoneChoices(device: string | null = deviceZone()): readonly string[] {
	let names: string[] = [];
	try {
		names = Intl.supportedValuesOf('timeZone').filter((z) => !UTC_NAMES.has(z));
	} catch {
		names = [];
	}
	if (device !== null && !names.includes(device)) names = [...names, device].sort();
	return names;
}
