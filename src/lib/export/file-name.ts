// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The name of an exported file: the plan's name, made safe for a file system, then what the file
 * is (`UI-basic-tasks.csv`). Letters and digits of any script stay; each run of anything else (a
 * space, a slash, a colon, a quote, a control character) becomes one hyphen. A plan whose name has
 * nothing left (empty, or only symbols) is called "plan".
 */
export function exportFileName(plan: string, ending: string): string {
	const slug = plan
		.normalize('NFC')
		.replace(/[^\p{L}\p{N}._]+/gu, '-')
		.replace(/^[-.]+|[-.]+$/g, '');
	return `${slug === '' ? 'plan' : slug}-${ending}`;
}
