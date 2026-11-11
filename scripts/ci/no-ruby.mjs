// SPDX-License-Identifier: GPL-2.0-or-later
// Fails if CI could invoke Ruby tooling (ruby, tj3, bundle, gem) from a workflow
// `run:` step, an npm script that CI invokes, or a file under tests/.
// The runner image ships Ruby, so the no-Ruby guarantee comes from this check.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN = /(?<![\w-])(ruby|tj3|bundle|gem)(?![\w-]|\.wasm\b)/;

/** Remove `#` and `//` comments (only when at line start or after whitespace). */
export function stripComments(line) {
	return line.replace(/(^|\s)(#|\/\/).*$/, '$1');
}

/** Return the forbidden word found in `text`, ignoring comments, or null. */
export function findForbidden(text) {
	for (const raw of text.split(/\r?\n/)) {
		const m = FORBIDDEN.exec(stripComments(raw));
		if (m) return m[1];
	}
	return null;
}

/** Extract the shell text of every `run:` step in a workflow file (minimal YAML scan). */
export function extractRunSteps(yaml) {
	const lines = yaml.split(/\r?\n/);
	const steps = [];
	for (let i = 0; i < lines.length; i++) {
		const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
		if (!m) continue;
		const indent = m[1].length;
		const value = m[2].trim();
		if (/^[|>][+-]?\d*\s*(#.*)?$/.test(value)) {
			const block = [];
			while (i + 1 < lines.length) {
				const next = lines[i + 1];
				const nextIndent = /^(\s*)/.exec(next)[1].length;
				if (next.trim() !== '' && nextIndent <= indent) break;
				block.push(next);
				i++;
			}
			steps.push(block.join('\n'));
		} else {
			steps.push(value);
		}
	}
	return steps;
}

/** Names of npm scripts invoked by the given shell text. */
export function npmScriptsInvoked(shell) {
	const names = new Set();
	for (const raw of shell.split(/\r?\n/)) {
		const line = stripComments(raw);
		for (const m of line.matchAll(/\bnpm\s+(?:run(?:-script)?\s+([\w:.-]+)|(test|start)\b)/g)) {
			names.add(m[1] ?? m[2]);
		}
	}
	return [...names];
}

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|ya?ml|sh|svelte|astro|md|txt|tj3?|html)$/;

export function check(root) {
	const problems = [];
	const wfDir = join(root, '.github', 'workflows');
	const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const used = new Set();

	if (existsSync(wfDir)) {
		for (const f of readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n))) {
			for (const step of extractRunSteps(readFileSync(join(wfDir, f), 'utf8'))) {
				const hit = findForbidden(step);
				if (hit) problems.push(`.github/workflows/${f}: run step invokes "${hit}"`);
				for (const n of npmScriptsInvoked(step)) used.add(n);
			}
		}
	}
	for (const n of used) {
		for (const key of [`pre${n}`, n, `post${n}`]) {
			const body = pkg.scripts?.[key];
			const hit = body && findForbidden(body);
			if (hit) problems.push(`package.json: npm script "${key}" invokes "${hit}"`);
		}
	}
	const testsDir = join(root, 'tests');
	if (existsSync(testsDir)) {
		for (const p of walk(testsDir)) {
			const rel = relative(root, p).split('\\').join('/');
			// The matcher's own unit test necessarily names the forbidden words.
			if (rel === 'tests/ci/no-ruby.test.ts' || !TEXT_EXT.test(rel)) continue;
			const hit = findForbidden(readFileSync(p, 'utf8'));
			if (hit) problems.push(`${rel}: invokes "${hit}"`);
		}
	}
	return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const problems = check(process.cwd());
	if (problems.length > 0) {
		console.error(
			'no-ruby: forbidden Ruby tooling found:\n' + problems.map((p) => '  ' + p).join('\n'),
		);
		process.exit(1);
	}
	console.log('no-ruby: ok');
}
