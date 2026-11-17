// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the Gantt reads from the browser: the theme (from the CSS tokens), the device pixel ratio,
 * the pointer type and the clock. Each is a rune, and `attach` keeps them current: the theme is
 * resolved again when the colour scheme or the app's theme choice (the `data-theme` attribute on
 * <html>), the pointer type (the coarse-pointer sizes are token overrides) or the fonts change, the ratio when the window moves to another screen, the clock
 * once a minute. It returns the function that stops listening.
 *
 * A theme is read only while the chart is on screen, and only if the tokens answered. A chart in a
 * hidden panel (the phone's other tabs, a People view over it) has no layout, and a read there may
 * come back empty, which is the light fallback in full: the chart would come back painted white in
 * dark mode. Such a read is skipped, the last good theme stays, and the chart reads again the
 * moment it is shown (its box grows from nothing).
 */
import { clearTextCache, effectiveDpr } from '../../lib/gantt/paint/canvas';
import { FALLBACK_THEME, themeIfShown, type Theme } from '../../lib/gantt/paint/theme';

const CLOCK_MS = 60_000;

export class GanttEnv {
	theme = $state.raw<Theme>(FALLBACK_THEME);
	dpr = $state(1);
	coarse = $state(false);
	nowMs = $state(Date.now());

	attach(root: HTMLElement): () => void {
		const read = (): void => {
			const t = themeIfShown(root);
			if (t) this.theme = t;
		};
		let wasShown = root.getClientRects().length > 0;
		const shown = new ResizeObserver(() => {
			const now = root.getClientRects().length > 0;
			if (now && !wasShown) read();
			wasShown = now;
		});
		shown.observe(root);
		const scheme = matchMedia('(prefers-color-scheme: dark)');
		const pointer = matchMedia('(pointer: coarse)');
		const onScheme = (): void => void requestAnimationFrame(read);
		const onPointer = (): void => {
			this.coarse = pointer.matches;
			requestAnimationFrame(read);
		};
		let resolution: MediaQueryList | null = null;
		const onResolution = (): void => {
			this.dpr = effectiveDpr(devicePixelRatio);
			watchResolution();
		};
		const watchResolution = (): void => {
			resolution?.removeEventListener('change', onResolution);
			resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
			resolution.addEventListener('change', onResolution);
		};
		read();
		this.coarse = pointer.matches;
		this.dpr = effectiveDpr(devicePixelRatio);
		watchResolution();
		scheme.addEventListener('change', onScheme);
		pointer.addEventListener('change', onPointer);
		// The theme toggle sets data-theme without a media change; the tokens change with it.
		const themeAttr = new MutationObserver(onScheme);
		themeAttr.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme'],
		});
		void document.fonts?.ready.then(() => {
			clearTextCache();
			read();
		});
		const clock = setInterval(() => (this.nowMs = Date.now()), CLOCK_MS);
		return () => {
			scheme.removeEventListener('change', onScheme);
			pointer.removeEventListener('change', onPointer);
			themeAttr.disconnect();
			shown.disconnect();
			resolution?.removeEventListener('change', onResolution);
			clearInterval(clock);
		};
	}
}
