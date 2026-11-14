// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The editor's look (phase-1.md 8.2): every colour is a design token from src/styles/tokens.css,
 * whose theme files switch light and dark with `data-theme`, so one theme serves both. The font
 * is the token monospace stack, at least 16 px so that iOS does not zoom on focus (8.1).
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { STALE_CLASS } from './lint';
import { SOURCE_CLASS } from './source-highlight';

const v = (name: string): string => `var(--${name})`;

export const tjpHighlightStyle = HighlightStyle.define([
	{ tag: t.keyword, color: v('color-syntax-keyword'), fontWeight: '600' },
	{ tag: [t.attributeName, t.typeName, t.namespace], color: v('color-syntax-keyword') },
	{ tag: t.definition(t.variableName), color: v('color-syntax-definition'), fontWeight: '600' },
	{ tag: [t.variableName, t.name], color: v('color-syntax-reference') },
	{ tag: t.atom, color: v('color-syntax-literal') },
	{ tag: t.string, color: v('color-syntax-string') },
	{ tag: [t.number, t.literal, t.unit], color: v('color-syntax-literal') },
	{ tag: [t.lineComment, t.blockComment], color: v('color-syntax-comment'), fontStyle: 'italic' },
	{ tag: [t.macroName, t.special(t.content)], color: v('color-syntax-macro') },
	{ tag: [t.operator, t.punctuation, t.separator, t.brace, t.paren], color: v('color-text-muted') },
	{ tag: t.invalid, color: v('color-syntax-invalid'), textDecoration: 'underline wavy' },
]);

const underline = (token: string): Record<string, string> => ({
	backgroundImage: 'none',
	textDecoration: `underline wavy ${v(token)}`,
	textDecorationSkipInk: 'none',
	textUnderlineOffset: '3px',
});

export const tjpEditorTheme = EditorView.theme({
	'&': {
		color: v('color-text'),
		backgroundColor: v('color-surface'),
		fontSize: `max(16px, ${v('text-md')})`,
	},
	'.cm-scroller': { fontFamily: v('font-mono'), lineHeight: v('leading') },
	'.cm-content': { caretColor: v('color-text') },
	'.cm-cursor, .cm-dropCursor': { borderLeftColor: v('color-text') },
	'&.cm-focused': { outline: `2px solid ${v('color-focus')}`, outlineOffset: '-2px' },
	'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
		backgroundColor: `${v('color-editor-selection')} !important`,
	},
	'.cm-activeLine': { backgroundColor: v('color-editor-active-line') },
	// The selected source (source-highlight.ts): a background and a rule, never colour alone. The
	// rule is an inset shadow, so it does not move the text; it follows each wrapped line.
	[`.cm-line.${SOURCE_CLASS}`]: {
		backgroundColor: v('color-source-highlight'),
		boxShadow: `inset 3px 0 0 ${v('color-source-rule')}`,
	},
	'.cm-gutters': {
		backgroundColor: v('color-surface'),
		color: v('color-text-muted'),
		borderRight: `1px solid ${v('color-border')}`,
	},
	'.cm-activeLineGutter': { backgroundColor: v('color-editor-active-line') },
	'.cm-foldPlaceholder': {
		backgroundColor: v('color-bg'),
		border: `1px solid ${v('color-border')}`,
		color: v('color-text-muted'),
	},
	'.cm-lintRange-error': underline('color-diagnostic-error'),
	'.cm-lintRange-warning': underline('color-diagnostic-warning'),
	'.cm-lintRange-info': underline('color-diagnostic-info'),
	// Stale marks keep the text in full colour (WCAG 1.4.3); only the underline turns dotted.
	[`.cm-lintRange.${STALE_CLASS}`]: { textDecorationStyle: 'dotted' },
	// Visually hidden, still read: the live region that says the problem under the cursor.
	'.cm-tjp-announce': {
		position: 'absolute',
		width: '1px',
		height: '1px',
		overflow: 'hidden',
		clip: 'rect(0 0 0 0)',
		whiteSpace: 'nowrap',
	},
	// The diagnostics panel in the app's colours (CodeMirror's are fixed light and dark greys, and
	// its focused row uses the system highlight colours), with a close button of at least 24 px
	// (WCAG 2.5.8).
	'.cm-panels': {
		backgroundColor: v('color-surface-sunken'),
		color: v('color-text'),
		borderColor: v('color-border'),
	},
	'.cm-panel.cm-panel-lint ul [aria-selected], .cm-panel.cm-panel-lint ul:focus [aria-selected]': {
		backgroundColor: v('color-row-selected'),
		color: v('color-text'),
	},
	'.cm-panel.cm-panel-lint [name=close]': {
		color: v('color-text'),
		minWidth: '1.75rem',
		minHeight: '1.75rem',
		cursor: 'pointer',
	},
	'.cm-tooltip': {
		backgroundColor: v('color-surface'),
		color: v('color-text'),
		border: `1px solid ${v('color-border')}`,
		borderRadius: v('radius-sm'),
		fontFamily: v('font-sans'),
		fontSize: v('text-sm'),
		maxWidth: 'min(36rem, calc(100vw - 2rem))',
	},
	'.cm-tooltip-autocomplete > ul': { fontFamily: v('font-mono') },
	'.cm-tooltip-autocomplete ul li[aria-selected]': {
		backgroundColor: v('color-accent'),
		color: v('color-accent-text'),
	},
	'.cm-completionDetail': { color: 'inherit', fontStyle: 'italic', marginLeft: v('space-2') },
	'.cm-completionInfo': { whiteSpace: 'pre-wrap', padding: v('space-2') },
	'.cm-tjp-hover': { padding: v('space-2'), display: 'grid', gap: v('space-1') },
	'.cm-tjp-hover-title': { fontWeight: '600' },
	'.cm-tjp-hover-code': { fontFamily: v('font-mono'), whiteSpace: 'pre-wrap' },
	'.cm-tjp-hover-body': { whiteSpace: 'pre-wrap' },
	'.cm-tjp-hover-note': { color: v('color-text-muted') },
	'.cm-diagnostic-error': { borderLeftColor: v('color-diagnostic-error') },
	'.cm-diagnostic-warning': { borderLeftColor: v('color-diagnostic-warning') },
	'.cm-diagnostic-info': { borderLeftColor: v('color-diagnostic-info') },
	// @codemirror/lint dims the source label to 70% strength at 70% size, which fails AA contrast
	// (WCAG 1.4.3) and is small to read; the doubled class outranks its rule in the tooltip and the panel.
	'.cm-diagnosticSource.cm-diagnosticSource': {
		color: v('color-text-muted'),
		opacity: '1',
		fontSize: '85%',
	},
});

/** The editor theme and the TJP highlight style. */
export function tjpTheme(): Extension {
	return [tjpEditorTheme, syntaxHighlighting(tjpHighlightStyle)];
}
