// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * How a view follows the open plan's preferences (ADR-0008 #3 amended). `AppState.openSerial` grows
 * each time a plan opens, and `AppState.planKey` is the plan part of its preference keys. The key
 * also changes without another plan opening: a sample's first change stores its copy (18.7), and
 * from then on the same plan, still on screen, keeps its preferences under `ws:<id>`. A view then
 * keeps what it shows and only writes under the new key (`rekey`); it starts over (`use`) only for
 * a plan that opened.
 *
 *   const follow = followPlan((k) => prefs.use(k), (k) => prefs.rekey(k));
 *   $effect(() => {
 *     const serial = app.openSerial;
 *     const key = app.planKey;
 *     untrack(() => follow(serial, key));
 *   });
 */
export function followPlan(
	use: (key: string) => void,
	rekey: (key: string) => void,
): (serial: number, key: string) => void {
	let opened: number | null = null;
	return (serial, key) => {
		if (serial === opened) return rekey(key);
		opened = serial;
		use(key);
	};
}
