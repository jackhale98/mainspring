// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The interface icons (ADR-0009 #4): stroke icons on a 24 px grid, drawn at a 1.8 px stroke, as
 * inline SVG path data. The glyphs follow Lucide (https://lucide.dev), which is ISC licensed:
 *
 *   ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
 *   Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 *   Permission to use, copy, modify, and/or distribute this software for any purpose with or
 *   without fee is hereby granted, provided that the above copyright notice and this permission
 *   notice appear in all copies.
 *
 * ISC is compatible with GPL-2.0-or-later (ADR-0001); the notice is repeated in
 * THIRD_PARTY_NOTICES.md. Each icon is a list of path strings so that the Icon component
 * (src/components/Icon.svelte) can render any of them, and the circles and rectangles are
 * written as paths by the two helpers below. Decorative: the component hides them from
 * assistive technology, and the control they sit on carries the name.
 */

const circle = (cx: number, cy: number, r: number): string =>
	`M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const rect = (x: number, y: number, w: number, h: number, r: number): string =>
	`M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

export const ICONS = {
	code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
	split: [rect(3, 3, 18, 18, 2), 'M12 3v18'],
	visual: ['M3 6h9', 'M7 12h11', 'M11 18h8'],
	undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
	redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
	sun: [
		circle(12, 12, 4),
		'M12 2v2',
		'M12 20v2',
		'm4.93 4.93 1.41 1.41',
		'm17.66 17.66 1.41 1.41',
		'M2 12h2',
		'M20 12h2',
		'm6.34 17.66-1.41 1.41',
		'm19.07 4.93-1.41 1.41',
	],
	moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
	system: [rect(2, 3, 20, 14, 2), 'M8 21h8', 'M12 17v4'],
	file: [
		'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
		'M14 2v4a2 2 0 0 0 2 2h4',
		'M10 9H8',
		'M16 13H8',
		'M16 17H8',
	],
	chevronDown: ['m6 9 6 6 6-6'],
	chevronRight: ['m9 18 6-6-6-6'],
	list: ['M21 12h-8', 'M21 6H8', 'M21 18h-8', 'M3 6v4a2 2 0 0 0 2 2h3', 'M3 10v6a2 2 0 0 0 2 2h3'],
	panel: [rect(3, 3, 18, 18, 2), 'M9 3v18'],
	close: ['M18 6 6 18', 'm6 6 12 12'],
	check: ['m5 12 5 5L20 7'],
	alert: [
		'm21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
		'M12 9v4',
		'M12 17h.01',
	],
	format: ['M15 12H3', 'M17 18H3', 'M21 6H3'],
	book: [
		'M12 7v14',
		'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
	],
	today: [rect(3, 4, 18, 18, 2), 'M16 2v4', 'M8 2v4', 'M3 10h18', circle(12, 16, 1.2)],
	route: [
		circle(6, 19, 3),
		'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15',
		circle(18, 5, 3),
	],
	retry: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
	grip: ['M9 5h.01', 'M9 12h.01', 'M9 19h.01', 'M15 5h.01', 'M15 12h.01', 'M15 19h.01'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;
