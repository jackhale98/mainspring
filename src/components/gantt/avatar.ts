// SPDX-License-Identifier: GPL-2.0-or-later
/** The avatar of a person in the people picker: two initials, and one of six colours. */

/** Up to two upper-case initials: "Ana López" is "AL", "dev" is "D". */
export const initials = (name: string): string =>
	name
		.split(/\s+/)
		.map((w) => w[0] ?? '')
		.join('')
		.slice(0, 2)
		.toUpperCase();

/** The token number (1 to 6) of a person's avatar colour, from their place in the plan. */
export const avatarColour = (index: number): number => (index % 6) + 1;
