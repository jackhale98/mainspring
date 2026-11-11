// SPDX-License-Identifier: GPL-2.0-or-later
//
// lib.mjs - pure helpers for record-native.mjs: canonical JSON, `now` checks,
// the CSV parser and the cross-check comparisons. No file system, no child
// processes, so tests/golden/*.test.ts can test them directly.

/**
 * ISO 8601 UTC with seconds, e.g. "2026-01-05T09:00:00Z". Must stay identical
 * to NOW_RE in engine/bridge/request.rb, which applies the same rules.
 */
export const NOW_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/**
 * Why `now` is not an acceptable options.now value, or null if it is. It must
 * match NOW_RE, name a real instant (no 2026-02-31, no T24:00:00) and fall on
 * a whole UTC hour.
 * @param {unknown} now
 * @returns {string | null}
 */
export function nowProblem(now) {
	if (typeof now !== 'string') return 'must be a string';
	const m = NOW_RE.exec(now);
	if (!m) return 'must be ISO 8601 UTC with seconds, such as 2026-01-05T09:00:00Z';
	const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
	const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
	const back = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(),
		t.getUTCMinutes(), t.getUTCSeconds()];
	if (back.join() !== [y, mo, d, h, mi, s].join()) return 'is not a real date and time';
	if (mi !== 0 || s !== 0) return 'must be on a whole UTC hour';
	return null;
}

/** GoldenPlan kinds (docs/phases/phase-0.md, section 3.4). */
export const PLAN_KINDS = ['upstream', 'poc', 'synthetic', 'bridge'];

/**
 * Problems with the manifest's GoldenPlan entries that can be found without
 * the file system, as "id: problem" strings; empty when it is valid.
 * @param {unknown} plans
 * @returns {string[]}
 */
export function manifestProblems(plans) {
	if (!Array.isArray(plans)) return ['manifest must be an array of GoldenPlan'];
	/** @type {string[]} */
	const out = [];
	const ids = new Set();
	for (const p of plans) {
		const id = JSON.stringify(p?.id);
		const bad = (/** @type {string} */ why) => out.push(`${id}: ${why}`);
		if (typeof p?.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) bad('id must be lower-case kebab');
		else if (ids.has(p.id)) bad('duplicate id');
		ids.add(p?.id);
		if (!PLAN_KINDS.includes(p?.kind)) bad(`kind must be one of ${PLAN_KINDS.join(', ')}`);
		for (const k of ['root', 'entry']) {
			if (typeof p?.[k] !== 'string' || !p[k]) bad(`${k} must be a non-empty string`);
		}
		if (p?.now !== null) {
			const why = nowProblem(p?.now);
			if (why) bad(`now ${why}`);
		}
		if (p?.files !== undefined && !(Array.isArray(p.files) && p.files.length)) bad('files must be a non-empty array');
		if (!Array.isArray(p?.features)) bad('features must be an array');
		if (p?.timeoutMs !== undefined && !(Number.isInteger(p.timeoutMs) && p.timeoutMs > 0)) {
			bad('timeoutMs must be a positive integer');
		}
	}
	return out;
}

/**
 * A copy of `v` with object keys sorted recursively (JS default sort).
 * @param {unknown} v
 * @returns {unknown}
 */
export function canonical(v) {
	if (Array.isArray(v)) return v.map(canonical);
	if (v && typeof v === 'object') {
		return Object.fromEntries(
			Object.keys(v)
				.sort()
				.map((k) => [k, canonical(/** @type {Record<string, unknown>} */ (v)[k])]),
		);
	}
	return v;
}

/**
 * The golden file format: sorted keys, 2-space indent, trailing newline.
 * @param {unknown} v
 */
export function canonicalJson(v) {
	return `${JSON.stringify(canonical(v), null, 2)}\n`;
}

/**
 * Parse TaskJuggler's CSV (CSVFile.rb): ';' separators, '"' quotes, '""' for a
 * quote inside a quoted field, '\n' line ends.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
	/** @type {string[][]} */
	const rows = [];
	/** @type {string[]} */
	let row = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ';') {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/**
 * Up to `limit` "path: expected X, got Y" lines where `a` and `b` differ.
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} [at]
 * @param {string[]} [out]
 * @param {number} [limit]
 * @returns {string[]}
 */
export function diffPaths(a, b, at = '', out = [], limit = 20) {
	if (out.length >= limit) return out;
	if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
		const ra = /** @type {Record<string, unknown>} */ (a);
		const rb = /** @type {Record<string, unknown>} */ (b);
		for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
			diffPaths(ra[k], rb[k], `${at}/${k}`, out, limit);
		}
	} else if (JSON.stringify(a) !== JSON.stringify(b)) {
		out.push(`${at || '/'}: expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`);
	}
	return out;
}

/**
 * ISO 8601 UTC (seconds, 'Z') for `minutes` after the ISO instant `start`.
 * @param {string} start
 * @param {number | null} minutes
 * @returns {string | null}
 */
export function minutesToIso(start, minutes) {
	if (minutes === null) return null;
	return new Date(Date.parse(start) + minutes * 60_000).toISOString().replace('.000Z', 'Z');
}

/**
 * @typedef {{ id: string, name: string, active: boolean }} Scenario
 * @typedef {{ start: number | null, end: number | null }} TaskDates
 * @typedef {{ id: string, scenarios: Record<string, TaskDates> }} Task
 * @typedef {{ project: { start: string, scenarios: Scenario[] } | null, tasks: Task[] }} Result
 */

/**
 * The rows the cross-check report should contain for a serializer result:
 * one per task (pre-order) and active scenario (pre-order), as
 * "scenario name | task id | start | end".
 * @param {Result} result
 * @returns {string[]}
 */
export function expectedRows(result) {
	if (!result.project) return [];
	const { start } = result.project;
	const active = result.project.scenarios.filter((s) => s.active);
	/** @type {string[]} */
	const rows = [];
	for (const t of result.tasks) {
		for (const s of active) {
			const d = t.scenarios[s.id];
			rows.push([s.name, t.id, minutesToIso(start, d?.start ?? null), minutesToIso(start, d?.end ?? null)].join(' | '));
		}
	}
	return rows;
}

const CSV_DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

/**
 * Rows of the cross-check CSV in the same form as expectedRows. TaskJuggler
 * leaves the id empty on the rows of the second and later scenarios of a
 * task; non-date cells (empty, "Error") become null.
 * @param {string[][]} csv  parsed CSV including the header row
 * @returns {string[]}
 */
export function csvRows(csv) {
	const [header, ...rows] = csv;
	if (header?.join(';') !== 'Scenario;Id;Start;End') {
		throw new Error(`unexpected cross-check CSV header: ${JSON.stringify(header)}`);
	}
	let lastId = '';
	return rows.map(([scenario = '', id = '', start = '', end = '']) => {
		lastId = id || lastId;
		const date = (/** @type {string} */ v) => (CSV_DATE.test(v) ? v : null);
		return [scenario, lastId, date(start), date(end)].join(' | ');
	});
}

/**
 * Lines describing where two row lists differ (at most `limit`).
 * @param {string[]} expected
 * @param {string[]} actual
 * @param {number} [limit]
 */
export function rowDiffs(expected, actual, limit = 10) {
	const out = [];
	for (let i = 0; i < Math.max(expected.length, actual.length) && out.length < limit; i++) {
		if (expected[i] !== actual[i]) {
			out.push(`row ${i + 1}: serializer ${expected[i] ?? '(none)'}; report ${actual[i] ?? '(none)'}`);
		}
	}
	return out;
}

/**
 * Make a path that the native process reported relative to `root` (an
 * absolute workspace directory), resolving '.' and '..' lexically. Paths
 * outside the workspace give null, as in engine/bridge/serialize.rb.
 * @param {string | null | undefined} name
 * @param {string} root
 * @returns {string | null}
 */
export function workspacePath(name, root) {
	if (!name) return null;
	const prefix = `${root.replace(/\/+$/, '')}/`;
	/** @type {string[]} */
	const parts = [];
	for (const seg of (name.startsWith('/') ? name : prefix + name).split('/')) {
		if (seg === '' || seg === '.') continue;
		if (seg === '..') parts.pop();
		else parts.push(seg);
	}
	const norm = `/${parts.join('/')}`;
	return norm.startsWith(prefix) ? norm.slice(prefix.length) : null;
}

/**
 * @typedef {{ level: string, id: string, text: string, file: string | null, line: number | null }} Msg
 * @typedef {{ level: string, id: string, text: string, file: string | null, line: number | null }} RawMsg
 */

/**
 * Messages as the native process recorded them, normalised the way the bridge
 * does: workspace-relative file, root prefix removed from the text, line 0 as
 * null.
 * @param {RawMsg[]} raw
 * @param {string} root
 * @returns {Msg[]}
 */
export function normaliseMessages(raw, root) {
	const prefix = `${root.replace(/\/+$/, '')}/`;
	return raw.map((m) => ({
		level: m.level,
		id: m.id,
		text: m.text.split(prefix).join(''),
		file: workspacePath(m.file, root),
		line: m.line && m.line > 0 ? m.line : null,
	}));
}

/**
 * Compare golden messages with the report process's, field by field (scenario
 * and column are left out: tj3 hides scenarios and has no columns).
 * @param {Msg[]} golden
 * @param {Msg[]} actual
 * @param {number} [limit]
 */
export function messageDiffs(golden, actual, limit = 10) {
	const pick = (/** @type {Msg | undefined} */ m) =>
		m ? JSON.stringify([m.level, m.id, m.file, m.line, m.text]) : '(none)';
	const out = [];
	for (let i = 0; i < Math.max(golden.length, actual.length) && out.length < limit; i++) {
		const a = pick(golden[i]);
		const b = pick(actual[i]);
		if (a !== b) out.push(`message ${i + 1}: serializer ${a}; report ${b}`);
	}
	return out;
}

/**
 * The first fatal or error message, or null.
 * @param {Msg[]} messages
 */
export function firstError(messages) {
	return messages.find((m) => m.level === 'error' || m.level === 'fatal') ?? null;
}
