// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The editor setup that `tjp()` leaves to the app (phase-1.md 6.7, 8.2): line numbers, folding,
 * active line, bracket matching, search, the standard and history keys, line wrapping (so that
 * a phone never scrolls sideways, WCAG 1.4.10) and an accessible name that includes the file.
 *
 * It goes into every file's state through the workspace's `extensions` factory, because the
 * view shows whichever state the workspace holds for the open file. Tab is not bound, so the
 * keyboard can always leave the editor (WCAG 2.1.2).
 */
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
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

export function editorSetup(path: WorkspacePath): Extension {
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
		keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap]),
	];
}
