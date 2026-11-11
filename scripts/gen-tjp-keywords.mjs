// SPDX-License-Identifier: GPL-2.0-or-later
// Builds src/lib/tjp/syntax/keywords.generated.ts, the committed keyword table (phase-1 spec 6.3,
// conflict 14.12): the parser and completion need it before the engine has booted, so it is
// generated from the same engine build and checked in CI.
//
//   npm run gen:keywords [-- --engine public/engine] [-- --check]
//
// Boots the built engine in Node (engine/golden/run-wasm.mjs) and calls syntax(). Needs
// `npm run build:engine` first. --check regenerates in memory and exits 1 if the committed file
// differs. The output keeps what the parser and completion need before boot (id, name, contexts,
// scenario flag, syntax line, summary); hover loads the full doc from syntax() at runtime.
//
// The pure helpers (buildTable, renderModule, formatModule, compareModule) are exported for
// tests/scripts/gen-tjp-keywords.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = 'src/lib/tjp/syntax/keywords.generated.ts';

/** Must equal GLOBAL_CONTEXT and PROLOG_CONTEXT in src/lib/tjp/syntax/types.ts. */
export const GLOBAL_CONTEXT = '';
export const PROLOG_CONTEXT = '<prolog>';

/** SyntaxReference calls the top level of a project file "properties". */
const ENGINE_GLOBAL = 'properties';

/**
 * TaskJuggler reads a file as `projectProlog projectDeclaration properties`, and the prolog holds
 * only `include` (of macro files) and `macro` (TjpSyntaxRules.rb, rule_project, rule_projectProlog
 * and rule_prologInclude). SyntaxReference gives `project` and `include.macro` no context and
 * `macro` only "properties", so the generator adds contexts to these three:
 * - `project` to GLOBAL_CONTEXT, which is the top level of any file not included elsewhere; the
 *   table does not encode that the prolog, the header and the properties come in that order.
 * - `include.macro` and `macro` to PROLOG_CONTEXT, the top level of a file included before the
 *   header. At GLOBAL_CONTEXT, `include` is `include.properties`.
 * `engine` is what syntax() is expected to report, so that a change upstream fails loudly here.
 */
export const EXTRA_CONTEXTS = /** @type {const} */ ({
	'include.macro': { engine: [], add: [PROLOG_CONTEXT] },
	macro: { engine: [ENGINE_GLOBAL], add: [PROLOG_CONTEXT] },
	project: { engine: [], add: [GLOBAL_CONTEXT] },
});

/**
 * Prefix of the header line naming the engine build. Informational only: the keywords come from
 * TaskJuggler's SyntaxReference in the pinned engine/tj, so a rebuilt bridge with the same tj
 * commit must not force a regeneration.
 */
const BUILD_LINE = '// Generated with engine build sha256 ';

const NAME_RE = /^[a-z][a-z0-9]*$/;

/** Code-unit order, independent of the locale. */
const byCodeUnit = (/** @type {string} */ a, /** @type {string} */ b) =>
	a < b ? -1 : a > b ? 1 : 0;

/**
 * @typedef {{ keyword: string, contexts: string[], syntax: string, summary: string,
 *   scenarioSpecific: boolean }} EngineKeyword
 * @typedef {{ tjVersion: string, keywords: EngineKeyword[] }} EngineSyntax
 * @typedef {{ keyword: string, name: string, contexts: string[], scenarioSpecific: boolean,
 *   syntax: string, summary: string }} Entry
 * @typedef {{ tj: string, tjCommit: string, bundleHash: string }} Provenance
 */

/**
 * The table entries from SyntaxDocs, sorted by keyword. Throws if the docs break an assumption the
 * parser relies on.
 * @param {EngineSyntax} docs
 * @returns {Entry[]}
 */
export function buildTable(docs) {
	const ids = new Set(docs.keywords.map((k) => k.keyword));
	if (ids.size !== docs.keywords.length) throw new Error('syntax(): duplicate keyword ids');
	for (const [id, { engine }] of Object.entries(EXTRA_CONTEXTS)) {
		const k = docs.keywords.find((x) => x.keyword === id);
		const got = k ? [...k.contexts].sort(byCodeUnit).join(',') : null;
		if (got !== engine.join(',')) {
			throw new Error(
				`syntax(): '${id}' has contexts [${got}], expected [${engine.join(',')}]; ` +
					'review EXTRA_CONTEXTS in scripts/gen-tjp-keywords.mjs',
			);
		}
	}
	const entries = docs.keywords.map((k) => {
		const idName = k.keyword.split('.')[0] ?? '';
		if (!NAME_RE.test(idName)) throw new Error(`syntax(): unexpected keyword id '${k.keyword}'`);
		const name = writtenName(k, idName);
		const contexts = new Set(
			k.contexts.map((c) => {
				if (c === ENGINE_GLOBAL) return GLOBAL_CONTEXT;
				if (!ids.has(c)) throw new Error(`syntax(): '${k.keyword}' names unknown context '${c}'`);
				return c;
			}),
		);
		const extra = EXTRA_CONTEXTS[/** @type {keyof typeof EXTRA_CONTEXTS} */ (k.keyword)];
		if (Object.hasOwn(EXTRA_CONTEXTS, k.keyword)) for (const c of extra.add) contexts.add(c);
		return {
			keyword: k.keyword,
			name,
			contexts: [...contexts].sort(byCodeUnit),
			scenarioSpecific: k.scenarioSpecific === true,
			syntax: oneLine(k.syntax),
			summary: oneLine(k.summary),
		};
	});
	entries.sort((a, b) => byCodeUnit(a.keyword, b.keyword));
	/** @type {Map<string, string>} */
	const seen = new Map();
	for (const e of entries) {
		for (const c of e.contexts) {
			const other = seen.get(`${c}\u0000${e.name}`);
			if (other) {
				throw new Error(`syntax(): '${other}' and '${e.keyword}' are both '${e.name}' in '${c}'`);
			}
			seen.set(`${c}\u0000${e.name}`, e.keyword);
		}
	}
	return entries;
}

/**
 * The keyword as written in a file. That is normally the documentation id without its scope
 * ('booking.task' is written 'booking'), but the parser matches the first word of the syntax line,
 * and the two can differ: TaskJuggler documents `leaveallowances` (TjpSyntaxRules.rb,
 * rule_leaveAllowances) under the id 'leaveallowance'. Entries that may appear somewhere and
 * whose syntax line starts with a keyword take that word. Documentation-only entries (no
 * contexts, e.g. 'halign.center', syntax 'center') keep the id.
 * @param {EngineKeyword} k
 * @param {string} idName
 */
function writtenName(k, idName) {
	if (k.contexts.length === 0) return idName;
	const first = /^[a-z][a-z0-9]*/.exec(k.syntax.trim())?.[0];
	return first ?? idName;
}

/** @param {string} s */
function oneLine(s) {
	return s.replace(/\s+/g, ' ').trim();
}

/**
 * The module source before Prettier.
 * @param {Entry[]} entries
 * @param {Provenance} from
 */
export function renderModule(entries, from) {
	const q = (/** @type {string} */ s) => JSON.stringify(s);
	const lines = [
		'// SPDX-License-Identifier: GPL-2.0-only',
		"// The syntax lines and summaries below are TaskJuggler's own keyword documentation, which is",
		'// GPL-2.0-only (engine/tj/COPYING).',
		'//',
		"// GENERATED by scripts/gen-tjp-keywords.mjs from the engine's syntax(); do not edit. After",
		'// `npm run build:engine`, run `npm run gen:keywords`. CI runs it with --check (spec 6.3, 14.12).',
		'// Over 400 lines because it is data: one entry per TaskJuggler keyword.',
		'//',
		`// TaskJuggler ${from.tj}, commit ${from.tjCommit}`,
		`${BUILD_LINE}${from.bundleHash} (informational; --check ignores it)`,
		"import type { KeywordEntry } from './types';",
		'',
		'/** Must equal SyntaxDocs.tjVersion. */',
		`export const TJ_VERSION = ${q(from.tj)};`,
		`export const TJ_COMMIT = ${q(from.tjCommit)};`,
		'',
		'export const KEYWORDS: readonly KeywordEntry[] = [',
		...entries.map(
			(e) =>
				`{ keyword: ${q(e.keyword)}, name: ${q(e.name)}, contexts: [${e.contexts.map(q).join(', ')}], ` +
				`scenarioSpecific: ${e.scenarioSpecific}, syntax: ${q(e.syntax)}, summary: ${q(e.summary)} },`,
		),
		'];',
		'',
	];
	return lines.join('\n');
}

/**
 * Formats the module with the repository's Prettier config, so format:check accepts it.
 * @param {string} source
 */
export async function formatModule(source) {
	const prettier = await import('prettier');
	const filepath = path.join(REPO, OUT);
	const options = (await prettier.resolveConfig(filepath)) ?? {};
	return prettier.format(source, { ...options, filepath });
}

/**
 * How the committed text compares with the fresh one, for --check. `ok` is false when the table
 * or the TaskJuggler version or commit differs; a different engine build alone is a note.
 * @param {string | null} committed
 * @param {string} fresh
 * @returns {{ ok: boolean, message: string | null }}
 */
export function compareModule(committed, fresh) {
	if (committed === fresh) return { ok: true, message: null };
	if (committed === null) return { ok: false, message: `${OUT} is missing` };
	const content = (/** @type {string} */ text) =>
		text
			.split('\n')
			.filter((l) => !l.startsWith(BUILD_LINE))
			.join('\n');
	if (content(committed) === content(fresh)) {
		return {
			ok: true,
			message:
				`note: ${OUT} was generated with another engine build; the table and the ` +
				'TaskJuggler commit match, so it needs no regeneration',
		};
	}
	const a = committed.split('\n');
	const b = fresh.split('\n');
	let i = 0;
	while (
		i < a.length &&
		(a[i] === b[i] || (a[i]?.startsWith(BUILD_LINE) && b[i]?.startsWith(BUILD_LINE)))
	)
		i++;
	return {
		ok: false,
		message:
			`${OUT} is stale: the keyword table or the TaskJuggler version or commit differs.\n` +
			`  first difference at line ${i + 1}:\n` +
			`  committed: ${a[i] ?? '<end of file>'}\n` +
			`  generated: ${b[i] ?? '<end of file>'}`,
	};
}

async function main() {
	const { values } = parseArgs({
		options: {
			check: { type: 'boolean', default: false },
			engine: { type: 'string', default: 'public/engine' },
		},
	});
	/** @type {string[]} */
	const bootLog = [];
	const { bootNodeEngine } = await import('../engine/golden/run-wasm.mjs');
	let engine;
	try {
		engine = await bootNodeEngine({
			dir: values.engine,
			log: (/** @type {string} */ stream, /** @type {string} */ line) =>
				bootLog.push(`[${stream}] ${line}`),
		});
	} catch (error) {
		// Ruby's output is kept quiet unless the boot fails.
		for (const line of bootLog) console.error(line);
		throw error;
	}
	/** @type {EngineSyntax} */
	const docs = engine.syntax();
	const v = engine.versions;
	if (docs.tjVersion !== v.tj) {
		throw new Error(`syntax() reports TaskJuggler ${docs.tjVersion}, the engine ${v.tj}`);
	}
	const entries = buildTable(docs);
	const fresh = await formatModule(
		renderModule(entries, { tj: v.tj, tjCommit: v.tjCommit, bundleHash: v.bundleHash }),
	);
	const out = path.join(REPO, OUT);
	if (values.check) {
		const committed = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
		const { ok, message } = compareModule(committed, fresh);
		if (!ok) {
			console.error(
				`gen-tjp-keywords --check: ${message}\nRun npm run gen:keywords and commit it.`,
			);
			return 1;
		}
		if (message) console.log(`gen-tjp-keywords --check: ${message}`);
		console.log(`gen-tjp-keywords --check: ${OUT} is up to date (${entries.length} keywords)`);
		return 0;
	}
	fs.writeFileSync(out, fresh);
	console.log(`${OUT}: ${entries.length} keywords, ${Buffer.byteLength(fresh)} bytes`);
	return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().then(
		// The booted engine keeps the event loop alive, so exit explicitly.
		(code) => process.exit(code),
		(error) => {
			console.error(error instanceof Error ? (error.stack ?? error.message) : error);
			process.exit(1);
		},
	);
}
