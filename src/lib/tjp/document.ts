// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * One TJP file as text plus its syntax tree (phase-1.md 6.1).
 *
 * - Offsets are UTF-16 offsets into the text. Lines break on '\n' only: a '\r' stays an ordinary
 *   character, as TaskJuggler's `gets` keeps it, so CRLF files round-trip. Build CodeMirror
 *   `Text` with `textOf` and change sets with `changeSetOf`, which both split on '\n' only.
 * - The tree is parsed with the file's top context (spec 5.2): 'global' for the entry file and
 *   files included at the top level after the project header, 'project' for files included in
 *   the header, 'prolog' for files included before it. The workspace (include graph) decides.
 * - `updateFile` reparses incrementally with `reuseFragments` (grammar/fragments.ts) rather than
 *   bare `TreeFragment.applyChanges`, so the result equals a fresh parse also next to syntax
 *   errors.
 */
import { ChangeSet, Text, type ChangeSpec } from '@codemirror/state';
import type { ChangedRange, Tree, TreeFragment } from '@lezer/common';
import type { WorkspacePath } from '../../engine/protocol';
import { reuseFragments, tjpParser } from './grammar/parser';
import type { ContextId, TopContextName } from './syntax/keywords';

export { CoverageError, printTree, syntaxIssues, type SyntaxIssue } from './tree';

export type TopContext = TopContextName;
export type { ContextId };

/** The only line separator of TJP documents. */
export const LINE_SEPARATOR = '\n';

/** Parses a whole file with the given top context (default 'global'). */
export function parseTjp(
	text: string,
	opts: { top?: TopContext; fragments?: readonly TreeFragment[] } = {},
): Tree {
	return tjpParser(opts.top ?? 'global').parse(text, opts.fragments);
}

/** A CodeMirror `Text` split on '\n' only, so '\r' is kept (module comment). */
export function textOf(text: string): Text {
	return Text.of(text.split(LINE_SEPARATOR));
}

/** `ChangeSet.of` with '\n' as the only line separator of inserted text. */
export function changeSetOf(spec: ChangeSpec, length: number): ChangeSet {
	return ChangeSet.of(spec, length, LINE_SEPARATOR);
}

export interface TjpFile {
	readonly path: WorkspacePath;
	readonly text: Text;
	readonly tree: Tree;
	/** Bumps on every change to this file (its text, or its tree after a new top context). */
	readonly version: number;
	readonly top: TopContext;
}

/** A file parsed from scratch. */
export function createFile(
	path: WorkspacePath,
	text: string | Text,
	top: TopContext = 'global',
	version = 0,
): TjpFile {
	const doc = typeof text === 'string' ? textOf(text) : text;
	return { path, text: doc, tree: parseTjp(doc.toString(), { top }), version, top };
}

/**
 * The file after `changes` (from `file.text`): new text, tree reparsed incrementally, version
 * bumped. Returns `file` itself for an empty change set. Throws RangeError when the change set
 * does not start from a document of this length.
 */
export function updateFile(file: TjpFile, changes: ChangeSet): TjpFile {
	if (changes.length !== file.text.length) {
		throw new RangeError(
			`change set for length ${changes.length} applied to ${file.path} of length ${file.text.length}`,
		);
	}
	if (changes.empty) return file;
	const ranges: ChangedRange[] = [];
	changes.iterChangedRanges((fromA, toA, fromB, toB) => {
		ranges.push({ fromA, toA, fromB, toB });
	});
	const text = changes.apply(file.text);
	const fragments = reuseFragments(file.tree, ranges);
	const tree = parseTjp(text.toString(), { top: file.top, fragments });
	return { path: file.path, text, tree, version: file.version + 1, top: file.top };
}

/** The file parsed with another top context (a full reparse); `file` itself if it is the same. */
export function withTop(file: TjpFile, top: TopContext): TjpFile {
	if (file.top === top) return file;
	return createFile(file.path, file.text, top, file.version + 1);
}
