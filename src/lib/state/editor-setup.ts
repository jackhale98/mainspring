// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The editor setup that `tjp()` leaves to the app (phase-1.md 6.7, 8.2): line numbers, folding,
 * active line, bracket matching, search, the standard keys, line wrapping (so that a phone never
 * scrolls sideways, WCAG 1.4.10) and an accessible name that includes the file.
 *
 * Undo (phase-2.md 6.7, ADR-0008): there is no CodeMirror history. Mod-Z, Mod-Shift-Z and Mod-Y
 * call the workspace history through `history` (history-keys.ts), so Mod-Z in the editor undoes
 * the last action anywhere, and so do the browser's own undo and redo inputs (`beforeinput`
 * `historyUndo` / `historyRedo`, from a context menu or a phone keyboard).
 *
 * It goes into every file's state through the workspace's `extensions` factory, because the
 * view shows whichever state the workspace holds for the open file. Tab is not bound, so the
 * keyboard can always leave the editor (WCAG 2.1.2).
 */
import { defaultKeymap } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from '@codemirror/view';
import type { WorkspacePath } from '../../engine/protocol';
import { strings } from '../strings';
import { historyBindings, historyInput, type HistoryCommands } from './history-keys';

const NO_HISTORY: HistoryCommands = { undo: () => false, redo: () => false };

export function editorSetup(path: WorkspacePath, history: HistoryCommands = NO_HISTORY): Extension {
	return [
		lineNumbers(),
		foldGutter(),
		highlightActiveLine(),
		highlightActiveLineGutter(),
		drawSelection(),
		bracketMatching(),
		EditorView.lineWrapping,
		EditorView.contentAttributes.of({
			'aria-label': strings.editor.label(path),
			'aria-multiline': 'true',
			// axe does not count a contenteditable as focusable content of the scroller (WCAG 2.1.1).
			tabindex: '0',
		}),
		keymap.of([...historyBindings(history), ...defaultKeymap, ...foldKeymap, ...searchKeymap]),
		EditorView.domEventHandlers({
			beforeinput(e) {
				const command = historyInput(e.inputType);
				if (!command) return false;
				e.preventDefault();
				if (command === 'undo') history.undo();
				else history.redo();
				return true;
			},
		}),
	];
}
