// SPDX-License-Identifier: GPL-2.0-or-later
// Fails if CI could invoke Ruby tooling (ruby, tj3, bundle, gem) from a workflow
// `run:` step, an npm script that CI invokes, or a file under tests/.
// The runner image ships Ruby, so the no-Ruby guarantee comes from this check.
//
// One workflow, .github/workflows/ruby-wasm.yml, may use Ruby as a build tool: it compiles the
// ruby.wasm interpreter (ADR-0020, amendment 2026-11-23). Its run steps are not checked for the
// Ruby words. Its whole text, comments included, and the npm scripts it invokes are checked for
// NATIVE_TJ instead: it must never run the scheduler natively or record goldens. golden:record and
// record-native are banned from every workflow's run steps and npm scripts.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN = /(?<![\w-])(ruby|tj3|bundle|gem)(?![\w-]|\.wasm\b)/;

/**
 * Names that contain a forbidden word but cannot run it: ruby.wasm's binaries (ruby.wasm,
 * ruby+stdlib.wasm, ruby.debug.wasm, ruby.debug+stdlib.wasm) and its npm packages
 * (@ruby/wasm-wasi, @ruby/<series>-wasm-wasi). They are blanked before matching, so a forbidden
 * word next to them is still found.
 */
export const SAFE_NAMES =
	/@ruby\/(?:\d+\.\d+-)?wasm-wasi(?![\w-])|(?<![\w-])ruby(?:\.debug)?(?:\+stdlib)?\.wasm\b/g;

/** The one workflow allowed to use Ruby as a build tool, by its file name in .github/workflows. */
export const RUBY_BUILD_WORKFLOW = 'ruby-wasm.yml';

/** Golden recording: banned from every workflow and from the npm scripts CI invokes. */
export const GOLDEN_RECORDING = /(?<![\w-])(golden:record|record-native)(?![\w-])/;

/**
 * Banned from RUBY_BUILD_WORKFLOW, where Ruby is available: TaskJuggler's commands (tj3, tj3man,
 * tj3d, tj3client...), its gem, its sources in engine/tj (anywhere in a word, so `-Iengine/tj/lib`
 * counts), and golden recording.
 */
export const NATIVE_TJ =
	/(?<![\w-])(tj3(?:[a-z_]+)?|taskjuggler|golden:record|record-native)(?![\w-])|(engine\/tj)(?![\w-])/;

/** Remove `#` and `//` comments (only when at line start or after whitespace). */
export function stripComments(line) {
	return line.replace(/(^|\s)(#|\/\/).*$/, '$1');
}

/**
 * Return the forbidden word found in `text`, or null. Comments are ignored unless
 * `keepComments`; SAFE_NAMES never match.
 */
export function findForbidden(text, pattern = FORBIDDEN, keepComments = false) {
	for (const raw of text.split(/\r?\n/)) {
		const line = (keepComments ? raw : stripComments(raw)).replace(SAFE_NAMES, ' ');
		const m = pattern.exec(line);
		if (m) return m[1] ?? m[2] ?? m[0];
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
	const usedByRubyBuild = new Set();

	if (existsSync(wfDir)) {
		for (const f of readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n))) {
			const text = readFileSync(join(wfDir, f), 'utf8');
			const rubyBuild = f === RUBY_BUILD_WORKFLOW;
			if (rubyBuild) {
				const hit = findForbidden(text, NATIVE_TJ, true);
				if (hit)
					problems.push(`.github/workflows/${f}: names "${hit}" (no native TaskJuggler here)`);
			}
			for (const step of extractRunSteps(text)) {
				const hit = rubyBuild ? null : findForbidden(step);
				if (hit) problems.push(`.github/workflows/${f}: run step invokes "${hit}"`);
				const golden = findForbidden(step, GOLDEN_RECORDING);
				if (golden) problems.push(`.github/workflows/${f}: run step invokes "${golden}"`);
				for (const n of npmScriptsInvoked(step)) {
					used.add(n);
					if (rubyBuild) usedByRubyBuild.add(n);
				}
			}
		}
	}
	for (const n of used) {
		for (const key of [`pre${n}`, n, `post${n}`]) {
			const body = pkg.scripts?.[key];
			if (!body) continue;
			const hit = findForbidden(body) ?? findForbidden(body, GOLDEN_RECORDING);
			if (hit) problems.push(`package.json: npm script "${key}" invokes "${hit}"`);
			const native = usedByRubyBuild.has(n) && findForbidden(body, NATIVE_TJ, true);
			if (native) {
				problems.push(
					`package.json: npm script "${key}" (run by ${RUBY_BUILD_WORKFLOW}) names "${native}"`,
				);
			}
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
