// SPDX-License-Identifier: GPL-2.0-or-later
// The editor packages stay out of the main chunk (phase-2.md 11.3): a Visual-first load must not
// fetch CodeMirror's view, language, commands, autocomplete, lint or search. The editor panel and
// src/lib/state/editor-bundle.ts are imported with `import()` only. This walks the static imports
// from the app shell and fails if any module reached that way imports one of those packages, which
// is how the split broke once (a value import of `isolateHistory` from `@codemirror/commands`).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from '../golden/corpus';

const EDITOR_PACKAGES =
	/from\s+'@codemirror\/(view|language|commands|autocomplete|lint|search)'|import\s+'@codemirror\/(view|language|commands|autocomplete|lint|search)'/;
const STATIC_IMPORT =
	/^\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s+'(\.[^']+)'|^\s*import\s+'(\.[^']+)'/gm;

function resolve(from: string, spec: string): string | null {
	const base = path.resolve(path.dirname(from), spec);
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.svelte.ts`,
		`${base}.svelte`,
		path.join(base, 'index.ts'),
	]) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
	}
	return null;
}

/** Every file reachable from the entry by static (non-type, non-dynamic) imports. */
function reachable(entry: string): Map<string, string[]> {
	const seen = new Map<string, string[]>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop() as string;
		if (seen.has(file)) continue;
		let text = fs.readFileSync(file, 'utf8');
		// A .svelte file's imports are in its script; the template has none.
		if (file.endsWith('.svelte'))
			text = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
		const edges: string[] = [];
		for (const m of text.matchAll(STATIC_IMPORT)) {
			const target = resolve(file, m[1] ?? m[2] ?? '');
			if (target) edges.push(target);
		}
		seen.set(file, edges);
		queue.push(...edges);
	}
	return seen;
}

describe('the editor chunk', () => {
	const entry = path.join(REPO, 'src/components/App.svelte');
	const graph = reachable(entry);

	it('is not reachable by static imports from the app shell', () => {
		const names = [...graph.keys()].map((f) => path.relative(REPO, f));
		expect(names).toContain('src/lib/state/app.svelte.ts');
		expect(names).toContain('src/lib/workspace/workspace.ts');
		expect(names).not.toContain('src/components/EditorPanel.svelte');
		expect(names).not.toContain('src/lib/state/editor-bundle.ts');
		expect(names).not.toContain('src/lib/state/editor-controller.ts');
	});

	it('imports none of the editor packages anywhere it is reachable', () => {
		const offenders = [...graph.keys()]
			.filter((file) => {
				const text = fs.readFileSync(file, 'utf8');
				return text
					.split('\n')
					.some(
						(line) =>
							!/^\s*(\*|\/\/)/.test(line) &&
							!/import\s+type\b/.test(line) &&
							EDITOR_PACKAGES.test(line),
					);
			})
			.map((f) => path.relative(REPO, f));
		expect(offenders).toEqual([]);
	});
});
