<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A sheet on the native <dialog>. It slides in from the start edge (the outline drawer on tablets)
	or the bottom (the docs, project and source sheets, and the task details on tablets and phones).

	Modal (the default): the browser traps focus, makes the page behind inert, closes on Escape and
	returns focus to what opened it. Clicking the backdrop closes it.

	Not modal (`modal={false}`, the task details): the chart behind stays alive, so a person can
	tap another task or scroll while the sheet is open, and the selected row is scrolled above it
	(phase-2.md 9.2, WCAG 2.4.11). There is no backdrop and no focus trap; Escape closes it and
	focus goes back to where it was. `focusOnOpen={false}` leaves the focus where it is, so a tap
	does not open a touch keyboard.

	`detent` ('half' or 'full') gives the bottom sheet a fixed height and a grabber: drag it up for
	full height, down to go back (down from half closes), or press it, which toggles the two heights
	(the keyboard and single-pointer alternative, WCAG 2.5.7). The rules are
	src/lib/inspector/detent.ts. `onheight` reports the open sheet's height in px.

	The bottom placement is `inset: 0` with an auto top margin, the way the browser centres a dialog.
	With `top: auto` instead, Safari on iPhone placed the sheet off screen and only the backdrop
	showed. It is `position: fixed` so that it does the same when it is not modal.

	Motion (the CSS tokens --sheet-ms, --sheet-out-ms and --ease-sheet, 200 and 180 ms; transform and
	opacity only; the browser does the easing; none with reduced motion):
	- It slides in with CSS. A change of height glides with one Web Animations call: a sheet that
	  grows has its box at the new height at once and slides up from where its top edge was; one that
	  shrinks keeps its old height (`--sheet-held`) until its top edge has come down, so that no gap
	  opens between it and the tab bar, then takes the new height in the frame the slide ends.
	- Every way of closing (the button, Escape, the backdrop, a drag down, the `open` prop) is
	  `requestClose`: the sheet slides away with CSS on `[data-closing]` (from where it is now, if it
	  is still sliding in or gliding: `--sheet-from`), still on screen with its content and with the
	  height it had, and a timer then closes the dialog. The person's close (`dismiss`) tells the
	  owner at once (`onclose`), so that an owner that opens the sheet again while it slides away is
	  heard: the exit stops and the sheet stays. A close the owner made through `open` is the same
	  slide; `onclose` is then called when the dialog has closed.
	- `onleft` runs once per closing in the task that closed the dialog (the timer; or the dialog's
	  `close` event for a close the browser made, a second Escape that is not cancelable). Before it,
	  the field that held a touch keyboard (blurred so that a modal sheet opens over no keyboard,
	  ui/keyboard.ts) gets its focus and selection back, unless the focus has gone somewhere on
	  purpose. The consumers freeze what a sheet shows while it goes (the owner's state may be cleared
	  by then); a timer that outlives the component does nothing.

	This file is over 400 lines because the placements (drawer, modal and non-modal bottom sheet)
	share one dialog and their styles are one cascade; splitting them would hide that.
-->
<script lang="ts" module>
	/** Whether a pointer is down now, for every sheet (one pair of listeners, set up on first use). */
	let pressed = false;
	let tracking = false;
	function track(): void {
		if (tracking || typeof window === 'undefined') return;
		tracking = true;
		const set = (v: boolean) => () => (pressed = v);
		window.addEventListener('pointerdown', set(true), true);
		window.addEventListener('pointerup', set(false), true);
		window.addEventListener('pointercancel', set(false), true);
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		TAP_SLOP,
		dragHeight,
		detentAfterDrag,
		toggled,
		type Detent,
	} from '../lib/inspector/detent';
	import { inspectorStrings as I, strings } from '../lib/strings';
	import { restoreFocus, whenKeyboardGone, type Focused } from '../lib/ui/keyboard';
	import { tick, untrack } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		open: boolean;
		side: 'start' | 'bottom';
		title: string;
		closeLabel?: string;
		modal?: boolean;
		/** Gives the bottom sheet a fixed height and a grabber; bind it to remember the height. */
		detent?: Detent | undefined;
		focusOnOpen?: boolean;
		/**
		 * The person closed the sheet: set the owner's `open` to false. It is called as the slide
		 * away begins, not at its end. When the dialog closes without the person having closed it (the
		 * owner did, through `open`, or the browser did) it is called once the dialog has closed.
		 */
		onclose: () => void;
		/**
		 * The sheet has just closed and, if the keyboard had to be let go for it, the field that held
		 * it has its focus and selection back. It runs once per closing, in the task that closed the
		 * dialog: the timer that ends the slide (WebKit keeps a tap's gesture through a timer, so a
		 * touch keyboard can come up again), or the dialog's own `close` event for a close the browser
		 * made. It runs for a close made through the `open` prop too, not only for the person's.
		 */
		onleft?: () => void;
		ondetent?: (d: Detent) => void;
		/** The distance from the viewport's bottom to the sheet's top, in px (0 when closed). */
		onheight?: (px: number) => void;
		/** Where the focus goes when the person closes a sheet that is not modal; true: handled. */
		onreturn?: () => boolean;
		/** What sits after the title in the header (a button, say). */
		actions?: Snippet;
		children: Snippet;
	}
	let {
		open,
		side,
		title,
		closeLabel = strings.editor.close,
		modal = true,
		detent,
		focusOnOpen = true,
		onclose,
		onleft,
		ondetent,
		onheight,
		onreturn,
		actions,
		children,
	}: Props = $props();

	track();
	const uid = $props.id();
	const titleId = `sheet-title-${uid}`;
	let dialog: HTMLDialogElement | undefined = $state();
	let dragPx = $state<number | null>(null);
	let opener: Element | null = null;
	/** A finger was down when it opened (a press and hold): the click that ends it is not a tap. */
	let openedPressed = false;
	/** The sheet is closed by its `open` prop (a tab changed), not by the person. */
	let byProp = false;
	/** It is sliding away: still on screen, with its content, until the slide ends. */
	let closing = $state(false);
	/** The detent it had when it began to go: the owner resets its own while the sheet slides away. */
	let heldDetent = $state<Detent | undefined>();
	let exitTimer: ReturnType<typeof setTimeout> | undefined;
	/** The owner has been told that the person closed it (once per closing). */
	let told = false;
	/** `onleft` has run for this closing. */
	let left = false;
	/** The field the touch keyboard was let go from, to give the focus back to when the sheet is gone. */
	let blurred: Focused | null = null;
	/** The height glide in progress (a shrink keeps its old height until it ends: `--sheet-held`). */
	let glide: Animation | null = null;

	/** A motion token of the sheet's CSS, in ms (unitless): 0 when the person asks for less motion. */
	const ms = (el: Element, token: string): number =>
		parseFloat(getComputedStyle(el).getPropertyValue(token)) || 0;

	/** What moves when the sheet goes: the panel in a modal bottom sheet (the dialog is the screen), else the dialog. */
	const panelOf = (el: HTMLDialogElement): HTMLElement | null =>
		side === 'bottom' && modal ? el.querySelector<HTMLElement>('.inner') : el;

	/** Ends a height glide (the height a shrink kept goes with it). */
	function endGlide(): void {
		glide?.cancel();
		glide = null;
		dialog?.style.removeProperty('--sheet-held');
	}

	/** `onleft`, once, after the focus has gone back to what held the keyboard. */
	function leftOnce(): void {
		if (left) return;
		left = true;
		restoreFocus(blurred, dialog);
		blurred = null;
		onleft?.();
	}

	/**
	 * Slides the sheet away, then closes the dialog (at once with reduced motion). The slide is CSS
	 * (`[data-closing]`) and starts from where the sheet is now (`--sheet-from`: mid slide-in, mid glide);
	 * a timer ends it, which in WebKit keeps the person's tap as the reason for what `onleft` does next.
	 */
	function requestClose(): void {
		const el = dialog;
		if (!el || !el.open || closing) return;
		const panel = panelOf(el);
		const here = panel ? getComputedStyle(panel).transform : 'none';
		if (here !== 'none') panel?.style.setProperty('--sheet-from', here);
		endGlide();
		const leave = (): void => {
			if (!el.isConnected) return;
			el.close();
			leftOnce();
		};
		const t = ms(el, '--sheet-out-ms');
		if (!t) return leave();
		heldDetent = detent;
		closing = true;
		exitTimer = setTimeout(leave, t);
	}

	/** The person closed it: slide away, and tell the owner now, so that a tap that opens it again is heard. */
	function dismiss(): void {
		requestClose();
		if (told) return;
		told = true;
		onclose();
	}

	/** Asked to open again while it was sliding away. */
	function stopExit(): void {
		clearTimeout(exitTimer);
		if (dialog) panelOf(dialog)?.style.removeProperty('--sheet-from');
		closing = false;
		byProp = false;
		told = false;
	}

	// Gone with the component: no timer may close, or tell, a dialog that is not there.
	$effect(() => () => clearTimeout(exitTimer));

	$effect(() => {
		if (!dialog) return;
		if (open && untrack(() => closing)) untrack(stopExit);
		if (open && !dialog.open) {
			opener = document.activeElement;
			openedPressed = pressed;
			left = false;
			if (modal) {
				// Opened over a touch keyboard, a sheet would appear above it, part way up the screen, and
				// drop when the keyboard goes: let it go first (the field is remembered), then open at the
				// final place.
				const el = dialog;
				whenKeyboardGone((was) => {
					blurred = was;
					if (open && el.isConnected && !el.open) el.showModal();
				});
			} else {
				dialog.show();
				// A tap on a task must not move the focus (a touch keyboard would open).
				if (!focusOnOpen && opener instanceof HTMLElement) opener.focus({ preventScroll: true });
			}
		} else if (!open && dialog.open && !untrack(() => closing)) {
			byProp = true;
			untrack(requestClose);
		}
	});

	// A bottom sheet that changes height (the grabber, a drag let go, a peek) glides on `transform`
	// only, so nothing is laid out while it travels. The height before is read by this effect, which
	// runs before the DOM changes, the height after in `tick`. A sheet that grows has its box at the
	// new height at once and slides up from where its top edge was. A sheet that shrinks keeps its old
	// height until its top edge has come down (a smaller box would leave a gap between it and the tab
	// bar while it slid), then takes the new one in the frame the slide ends.
	$effect.pre(() => {
		void detent;
		const el = dialog;
		// While a finger drags it the height follows the finger: the glide is for what comes after.
		const was = el && dragPx === null && !closing ? el.offsetHeight : 0;
		const duration = el ? ms(el, '--sheet-ms') : 0;
		if (!el || !was || !duration) return;
		void tick().then(() => {
			if (closing || !el.isConnected) return;
			const dy = el.offsetHeight - was;
			if (dy === 0) return;
			endGlide();
			// The curve of --ease-sheet (tokens.css); the browser does the easing.
			const timing = { duration, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
			if (dy > 0) {
				glide = el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], timing);
				return;
			}
			el.style.setProperty('--sheet-held', `${was}px`);
			const shrink = el.animate([{ transform: 'none' }, { transform: `translateY(${-dy}px)` }], {
				...timing,
				fill: 'forwards',
			});
			glide = shrink;
			void shrink.finished.then(
				() => glide === shrink && endGlide(),
				() => undefined,
			);
		});
	});

	// The sheet's height, for what has to stay clear of it (the chart's selected row).
	$effect(() => {
		const el = dialog;
		if (!el || !onheight || !open) return;
		// From the viewport's bottom: a sheet that ends above the tab bar still covers that much.
		// Measured from the layout (its height and its bottom margin), not from where it is drawn:
		// while it slides in, its rectangle is still moving and said 78 px for a 380 px sheet, so the
		// chart kept no room for it and the toasts did not clear it.
		const report = (): void =>
			onheight(Math.round(el.offsetHeight + (parseFloat(getComputedStyle(el).marginBottom) || 0)));
		const ro = new ResizeObserver(report);
		ro.observe(el);
		report();
		return () => {
			ro.disconnect();
			onheight(0);
		};
	});

	function backdropClick(event: MouseEvent): void {
		// A press and hold opens a sheet while the finger is down; its release then clicks what is
		// under the finger, which is this sheet's backdrop. That one click is not a request to close.
		if (openedPressed) {
			openedPressed = false;
			return;
		}
		if (modal && event.target === dialog) dismiss();
	}

	/** A non-modal dialog does not close on Escape by itself. */
	function onkeydown(event: KeyboardEvent): void {
		if (modal || event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		dismiss();
	}

	/** Escape on a modal dialog: slide away first instead of vanishing. */
	function oncancel(event: Event): void {
		event.preventDefault();
		dismiss();
	}

	function closed(): void {
		clearTimeout(exitTimer);
		endGlide();
		if (dialog) panelOf(dialog)?.style.removeProperty('--sheet-from');
		closing = false;
		dragPx = null;
		leftOnce();
		// Focus goes back where the owner says (the selected row), else to what was focused before
		// the sheet opened, if it is still there; not when a tab change closed it.
		if (!modal && !byProp && !onreturn?.() && opener instanceof HTMLElement && opener.isConnected) {
			opener.focus({ preventScroll: true });
		}
		byProp = false;
		opener = null;
		if (!told) onclose();
		told = false;
	}

	let drag: { id: number; y0: number; h0: number } | null = null;

	function down(e: PointerEvent): void {
		if (!dialog || e.button !== 0) return;
		endGlide();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { id: e.pointerId, y0: e.clientY, h0: dialog.getBoundingClientRect().height };
	}
	function move(e: PointerEvent): void {
		if (!drag || e.pointerId !== drag.id) return;
		const dy = e.clientY - drag.y0;
		if (Math.abs(dy) > TAP_SLOP) dragPx = dragHeight(drag.h0, dy, window.innerHeight);
	}
	function up(e: PointerEvent): void {
		if (!drag || e.pointerId !== drag.id || !detent) return;
		const dy = e.clientY - drag.y0;
		drag = null;
		const next = Math.abs(dy) <= TAP_SLOP ? toggled(detent) : detentAfterDrag(detent, dy);
		// Closing keeps the dragged height while it slides away (closed() lets go of it).
		if (next === 'close') dismiss();
		else {
			dragPx = null;
			ondetent?.(next);
		}
	}
	function cancel(): void {
		drag = null;
		dragPx = null;
	}
	/** The press itself is handled by the pointer events; this is the keyboard's Enter and Space. */
	function press(e: MouseEvent): void {
		if (detent && e.detail === 0) ondetent?.(toggled(detent));
	}
</script>

<!-- Escape is handled by the dialog itself (or above); a click on the backdrop is a pointer shortcut. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialog}
	class="sheet"
	data-side={side}
	data-modal={modal}
	data-detent={closing ? heldDetent : detent}
	data-dragging={dragPx !== null ? '' : undefined}
	style:block-size={dragPx === null ? undefined : `${dragPx}px`}
	aria-labelledby={titleId}
	data-closing={closing ? '' : undefined}
	onclose={closed}
	{oncancel}
	onclick={backdropClick}
	onpointerdown={() => (openedPressed = false)}
	{onkeydown}
>
	{#if open || closing}
		<div class="inner">
			{#if detent}
				<button
					type="button"
					class="grabber"
					aria-label="{I.grabber}: {detent === 'full' ? I.grabberHalf : I.grabberFull}"
					aria-expanded={detent === 'full'}
					onpointerdown={down}
					onpointermove={move}
					onpointerup={up}
					onpointercancel={cancel}
					onclick={press}
				>
					<span class="bar"></span>
				</button>
			{/if}
			<header>
				<h2 id={titleId}>{title}</h2>
				{@render actions?.()}
				<button type="button" class="close" onclick={dismiss}>
					<Icon name="close" size={15} />{closeLabel}
				</button>
			</header>
			<!--
				The bottom sheet holds plain text that can scroll. Safari does not make a scrolling
				element keyboard-reachable on its own (axe scrollable-region-focusable), so it is a
				named, focusable region. The drawer's content is an interactive tree and needs no stop.
			-->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="content"
				role={side === 'bottom' ? 'region' : undefined}
				aria-labelledby={side === 'bottom' ? titleId : undefined}
				tabindex={side === 'bottom' ? 0 : undefined}
			>
				{@render children()}
			</div>
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		padding: 0;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-raised);
		max-inline-size: none;
		max-block-size: none;
	}
	.sheet::backdrop {
		background: var(--color-overlay);
		animation: fade-in calc(var(--sheet-ms) * 1ms) ease-out;
	}
	/* The drawer floats like a panel: inset from the edges, rounded on the open side. */
	.sheet[data-side='start'] {
		inset: var(--gap-panel) auto var(--gap-panel) var(--gap-panel);
		inline-size: min(22rem, 90vw);
		block-size: calc(100dvh - 2 * var(--gap-panel));
		border: 0;
		border-radius: var(--radius-panel);
		animation: slide-start calc(var(--sheet-ms) * 1ms) var(--ease-sheet);
	}
	/* Pinned to the bottom the way the browser centres a dialog: inset 0, fit-content height, and
	   an auto top margin. With top: auto instead, Safari on iPhone placed the sheet off screen and
	   only the backdrop showed. */
	.sheet[data-side='bottom'] {
		position: fixed;
		inset: 0;
		margin: auto auto 0;
		inline-size: min(40rem, 100vw);
		block-size: fit-content;
		max-block-size: 80dvh;
		border-block-end: 0;
		border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
		animation: slide-bottom calc(var(--sheet-ms) * 1ms) var(--ease-sheet);
	}
	/* Not modal: above the chart and the tab bar, below the toasts (which clear it). */
	.sheet[data-side='bottom'][data-modal='false'] {
		z-index: 20;
		/* The sheet's own width, so a tablet gets a sheet and not a full-width slab. */
		inline-size: min(44rem, 100vw);
	}
	/*
	   A modal bottom sheet (the docs, the project settings, the source) is a transparent dialog that
	   fills the viewport, with the panel pinned to its foot by flexbox. Nothing then depends on how
	   the browser sizes or places a top-layer dialog: on a real iPhone (a home-screen app) the
	   fit-content box with an auto top margin was laid out off screen, so only the backdrop showed.
	   A tap on the empty part is a tap on the dialog itself, which closes it (backdropClick).
	*/
	.sheet[data-side='bottom'][data-modal='true'] {
		inset: 0;
		margin: 0;
		inline-size: 100%;
		block-size: 100%;
		max-block-size: none;
		border: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		animation: none;
	}
	.sheet[data-side='bottom'][data-modal='true'][open] {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: center;
	}
	.sheet[data-side='bottom'][data-modal='true'] .inner {
		inline-size: min(40rem, 100%);
		block-size: auto;
		max-block-size: 80%;
		border: 1px solid var(--color-border);
		border-block-end: 0;
		border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
		background: var(--color-surface);
		box-shadow: var(--shadow-raised);
		padding-block-end: env(safe-area-inset-bottom);
		animation: slide-bottom calc(var(--sheet-ms) * 1ms) var(--ease-sheet);
	}
	/* On a phone the sheet ends above the floating tab bar (the margin, not a padding, so that the
	   top stays auto and the sheet keeps the iPhone placement above). The heights below are shares
	   of what is left. */
	@media (max-width: 599px) {
		.sheet[data-side='bottom'][data-modal='false'] {
			margin-block-end: var(--tabbar-clearance);
			--room: calc(100dvh - var(--tabbar-clearance));
			/* It slides in from below the tab bar, not from the bar's top edge. */
			--rest: var(--tabbar-clearance);
		}
	}
	.sheet[data-detent='half'] {
		block-size: var(--sheet-held, calc(var(--room, 100dvh) / 2));
		max-block-size: none;
	}
	/* A peek: the grabber and the header, while the Gantt makes a link or lifts a row. */
	.sheet[data-detent='peek'] {
		block-size: var(--sheet-held, calc(var(--size-tap) + 4rem));
		max-block-size: none;
		overflow: hidden;
	}
	.sheet[data-detent='full'] {
		block-size: var(--sheet-held, calc(var(--room, 100dvh) - 12px - env(safe-area-inset-top)));
		max-block-size: none;
	}
	/* A phone's top bar holds Undo and Redo (edits make no toast there): full height stops below it. */
	@media (max-width: 599px) {
		.sheet[data-detent='full'] {
			block-size: var(
				--sheet-held,
				calc(var(--room, 100dvh) - var(--size-topbar) - env(safe-area-inset-top))
			);
		}
	}
	.sheet[data-dragging] {
		max-block-size: none;
		animation: none;
		user-select: none;
	}
	.inner {
		display: flex;
		flex-direction: column;
		max-block-size: inherit;
		block-size: 100%;
	}
	/* The grabber is 44 px high to touch and draws a small bar; it is a button, so a keyboard or
	   a tap toggles the height as well. */
	.grabber {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		block-size: var(--size-tap);
		margin-block-end: -8px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		cursor: grab;
		touch-action: none;
	}
	.grabber .bar {
		inline-size: 40px;
		block-size: 5px;
		border-radius: var(--radius-pill);
		background: var(--color-border-strong);
	}
	.grabber:hover .bar {
		background: var(--color-text-muted);
	}
	.grabber:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -4px;
		border-radius: var(--radius-md);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		border-block-end: 1px solid var(--color-border);
	}
	h2 {
		margin: 0;
		margin-inline-end: auto;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
	.close {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-block-size: var(--size-tap);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	.close:hover {
		background: var(--color-row-hover);
	}
	.content {
		flex: 1;
		min-block-size: 0;
		overflow: auto;
		overscroll-behavior: contain;
		padding: var(--space-3) var(--space-4) var(--space-6);
	}
	.content:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}
	.sheet[data-side='start'] .content {
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	@keyframes slide-start {
		from {
			transform: translateX(-100%);
		}
	}
	@keyframes slide-bottom {
		from {
			transform: translateY(calc(100% + var(--rest, 0px)));
		}
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
	/* Going: the same moves backwards, on transform and opacity only. Heavier selectors than the
	   ones that place the sheet, so that they win (also over a drag's `animation: none`). */
	.sheet[data-closing]::backdrop {
		animation: fade-out calc(var(--sheet-out-ms) * 1ms) ease-in forwards;
	}
	.sheet[data-side='bottom'][data-closing],
	.sheet[data-side='bottom'][data-modal='true'][data-closing] .inner {
		animation: leave-bottom calc(var(--sheet-out-ms) * 1ms) ease-in forwards;
	}
	.sheet[data-side='bottom'][data-modal='true'][data-closing] {
		animation: none;
	}
	.sheet[data-side='start'][data-closing] {
		animation: leave-start calc(var(--sheet-out-ms) * 1ms) ease-in forwards;
	}
	@keyframes leave-bottom {
		from {
			transform: var(--sheet-from, none);
		}
		to {
			transform: translateY(calc(100% + var(--rest, 0px)));
		}
	}
	@keyframes leave-start {
		from {
			transform: var(--sheet-from, none);
		}
		to {
			transform: translateX(calc(-100% - var(--gap-panel)));
		}
	}
	@keyframes fade-out {
		to {
			opacity: 0;
		}
	}
</style>
