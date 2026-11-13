// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The undo and redo keys (phase-2.md 6.7, ADR-0008): Mod-Z undoes, Mod-Shift-Z and Mod-Y redo,
 * in the editor (editor-setup.ts binds them through `historyBindings`) and everywhere else
 * (`bindHistoryKeys` on the window). "Mod" is Cmd on Apple platforms and Ctrl elsewhere, as in
 * CodeMirror.
 *
 * Outside the editor the keys are left alone in text fields (an input, a textarea or another
 * contenteditable keeps its own undo) and when something already handled them: the editor's
 * keymap prevents the default of a key it ran.
 */
import type { KeyBinding } from '@codemirror/view';

/** What the keys and the top bar's buttons call; true when something was undone or redone. */
export interface HistoryCommands {
	undo(): boolean;
	redo(): boolean;
}

/**
 * The editor's bindings. They always report the key as handled, so the browser's own undo never
 * runs on the editor's content, even when there is nothing to undo.
 */
export function historyBindings(h: HistoryCommands): readonly KeyBinding[] {
	const undo = () => (h.undo(), true);
	const redo = () => (h.redo(), true);
	return [
		{ key: 'Mod-z', run: undo, preventDefault: true },
		{ key: 'Mod-Shift-z', run: redo, preventDefault: true },
		{ key: 'Mod-y', run: redo, preventDefault: true },
	];
}

/** The history command a `beforeinput` event asks for (the browser's menu, a phone keyboard). */
export function historyInput(inputType: string): 'undo' | 'redo' | null {
	return inputType === 'historyUndo' ? 'undo' : inputType === 'historyRedo' ? 'redo' : null;
}

const APPLE = /Mac|iPhone|iPad|iPod/;

function isApple(): boolean {
	const nav = globalThis.navigator as Navigator | undefined;
	return nav !== undefined && APPLE.test(nav.platform);
}

/** The history command for a key event, or null (module comment). */
export function historyKey(e: KeyboardEvent, apple = isApple()): 'undo' | 'redo' | null {
	const mod = apple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
	if (!mod || e.altKey) return null;
	const key = e.key.toLowerCase();
	if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
	if (key === 'y' && !e.shiftKey) return 'redo';
	return null;
}

function editable(target: EventTarget | null): boolean {
	if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
	if (target.closest('input, textarea, select')) return true;
	const host = target.closest('[contenteditable]');
	return host !== null && host.getAttribute('contenteditable') !== 'false';
}

/** Binds the keys outside the editor on `target` (the window); returns the unbind. */
export function bindHistoryKeys(target: EventTarget, h: HistoryCommands): () => void {
	const onKey = (ev: Event) => {
		const e = ev as KeyboardEvent;
		if (e.defaultPrevented || editable(e.target)) return;
		const command = historyKey(e);
		if (!command) return;
		e.preventDefault();
		if (command === 'undo') h.undo();
		else h.redo();
	};
	target.addEventListener('keydown', onKey);
	return () => target.removeEventListener('keydown', onKey);
}
