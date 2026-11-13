// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the Gantt reads from the browser: the theme (from the CSS tokens), the device pixel ratio,
 * the pointer type and the clock. Each is a rune, and `attach` keeps them current: the theme is
 * resolved again when the colour scheme, the pointer type (the coarse-pointer sizes are token
 * overrides) or the fonts change, the ratio when the window moves to another screen, the clock
 * once a minute. It returns the function that stops listening.
 */
import { clearTextCache, effectiveDpr } from '../../lib/gantt/paint/canvas';
import { FALLBACK_THEME, themeOf, type Theme } from '../../lib/gantt/paint/theme';

const CLOCK_MS = 60_000;

export class GanttEnv {
	theme = $state.raw<Theme>(FALLBACK_THEME);
	dpr = $state(1);
	coarse = $state(false);
	nowMs = $state(Date.now());

	attach(root: HTMLElement): () => void {
		const read = (): void => {
			this.theme = themeOf(root);
		};
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
		void document.fonts?.ready.then(() => {
			clearTextCache();
			read();
		});
		const clock = setInterval(() => (this.nowMs = Date.now()), CLOCK_MS);
		return () => {
			scheme.removeEventListener('change', onScheme);
			pointer.removeEventListener('change', onPointer);
			resolution?.removeEventListener('change', onResolution);
			clearInterval(clock);
		};
	}
}
