// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Mentions of a task or resource id in text the edit API cannot fix: macro bodies and opaque
 * statements (5.4 References). The scan is conservative: the full id, or `!` or `.` followed by
 * the local id, counts, at word boundaries, wherever it occurs in such a range (strings and
 * comments included).
 */
import type { TextOnly } from '../text-only';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { FileFacts } from './facts';
import type { PropertyKind } from './types';

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mentionPattern(kind: PropertyKind, id: string): RegExp {
	const local = kind === 'task' ? id.slice(id.lastIndexOf('.') + 1) : id;
	const full = `(?<![\\w.!])${escape(id)}`;
	const rel = `[!.]${escape(local)}`;
	return new RegExp(`(?:${full}|${rel})(?!\\w)`, 'g');
}

export function findMentions(
	ws: WorkspaceSnapshot,
	facts: Iterable<FileFacts>,
	kind: PropertyKind,
	id: string,
): TextOnly[] {
	const re = mentionPattern(kind, id);
	const out: TextOnly[] = [];
	for (const f of facts) {
		const doc = ws.files.get(f.file.path)?.text;
		if (!doc) continue;
		for (const span of f.opaque) {
			const text = doc.sliceString(span.at.from, span.at.to);
			re.lastIndex = 0;
			for (let m = re.exec(text); m; m = re.exec(text)) {
				const from = span.at.from + m.index;
				out.push({
					reason: span.reason,
					at: { file: f.file.path, from, to: from + m[0].length },
					within: null,
				});
			}
		}
	}
	return out;
}
