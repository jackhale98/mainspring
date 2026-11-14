// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Target sizes (phase-2.md 10.3): the visible interactive elements of a page whose box is smaller
 * than a minimum, for the a11y audit. WCAG 2.5.8 (AA) wants 24 x 24 CSS px; the project's rule for
 * a coarse pointer is 44 x 44. The size read is the element's own box, or, for a checkbox, radio
 * or file input drawn small inside a larger label, the label's (a label is part of the target).
 * Inline links inside a sentence are exempt in WCAG, and are skipped here too.
 */
import type { Page } from '@playwright/test';

export interface SmallTarget {
	/** A selector-like description: tag, role, accessible name, and a class. */
	what: string;
	width: number;
	height: number;
}

const INTERACTIVE =
	'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="menuitem"], ' +
	'[role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="separator"][tabindex], ' +
	'[role="slider"], [role="spinbutton"], [role="combobox"], [tabindex]:not([tabindex="-1"])';

export async function smallTargets(page: Page, min = 44): Promise<SmallTarget[]> {
	return page.evaluate(
		([selector, minimum]) => {
			const out: SmallTarget[] = [];
			const seen = new Set<Element>();
			const visible = (el: Element): boolean => {
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) return false;
				const cs = getComputedStyle(el);
				if (cs.visibility === 'hidden' || cs.display === 'none') return false;
				// Clipped screen-reader text (the sr-only pattern) is not a target.
				if (cs.clip !== 'auto' && r.width <= 1 && r.height <= 1) return false;
				// Scrolled out of the viewport entirely: not a target now.
				return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
			};
			const name = (el: Element): string => {
				const label =
					el.getAttribute('aria-label') ??
					(el as HTMLInputElement).labels?.[0]?.textContent ??
					el.textContent ??
					'';
				return label.replace(/\s+/g, ' ').trim().slice(0, 40);
			};
			for (const el of document.querySelectorAll(selector as string)) {
				if (seen.has(el) || !visible(el)) continue;
				seen.add(el);
				// Inside a sentence: an inline link.
				if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
				let box = el.getBoundingClientRect();
				if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
					const l = el.closest('label') ?? el.labels?.[0];
					if (l) box = l.getBoundingClientRect();
				}
				if (box.width + 0.5 >= (minimum as number) && box.height + 0.5 >= (minimum as number))
					continue;
				const cls =
					typeof (el as HTMLElement).className === 'string'
						? (el as HTMLElement).className
								.split(/\s+/)
								.filter((c) => c && !c.startsWith('svelte-'))
								.slice(0, 2)
								.join('.')
						: '';
				out.push({
					what: `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${cls ? `.${cls}` : ''} "${name(el)}"`,
					width: Math.round(box.width * 10) / 10,
					height: Math.round(box.height * 10) / 10,
				});
			}
			return out;
		},
		[INTERACTIVE, min] as const,
	);
}
