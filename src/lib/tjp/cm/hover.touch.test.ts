// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// On touch the keyword and id hover stays away (it covers the text being edited); the Docs button
// shows the same content (`docsAtCursor`). A mouse or trackpad still gets it (user, 2026-11-16).
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { keywordHover, keywordHoverSource, touchPointer } from './hover';
import { TABLE_ONLY, tjpState } from './testing';

const DOC = 'task t "T" {\n  effort 5d\n}\n';

function pointer(view: EditorView, type: 'pointerdown' | 'pointermove', pointerType: string): void {
	const e = new Event(type, { bubbles: true });
	Object.defineProperty(e, 'pointerType', { value: pointerType });
	view.contentDOM.dispatchEvent(e);
}

describe('keyword hover and touch', () => {
	it('shows the popup for a mouse and none after a finger or a pen', () => {
		const withHover = new EditorView({
			state: tjpState(DOC, { extra: [keywordHover(() => TABLE_ONLY)] }),
		});
		const source = keywordHoverSource(() => TABLE_ONLY);
		const pos = DOC.indexOf('effort') + 2;
		expect(source(withHover, pos)).not.toBeNull();
		pointer(withHover, 'pointerdown', 'touch');
		expect(touchPointer(withHover)).toBe(true);
		expect(source(withHover, pos)).toBeNull();
		pointer(withHover, 'pointermove', 'mouse');
		expect(source(withHover, pos)).not.toBeNull();
		pointer(withHover, 'pointerdown', 'pen');
		expect(source(withHover, pos)).toBeNull();
		withHover.destroy();
	});
});
