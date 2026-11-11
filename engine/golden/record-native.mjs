#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// record-native.mjs - record or verify the native golden outputs
// (docs/phases/phase-0.md, section 6.2). Developer-only: CI never runs it.
//
//   node engine/golden/record-native.mjs [--verify] [--only <id>]... [--allow-ruby]
//   (npm run golden:record / npm run golden:verify)
//
// For each plan in manifest.json it runs engine/bridge/native/record.rb twice
// under `bundle exec` (engine/golden/Gemfile.lock) with TZ=UTC and
// LANG=C.UTF-8, fails if the two outputs differ, cross-checks the result
// against the real tj3 CLI (see crossCheck below), then writes
// expected/<id>.json and native-timings.json. Nothing is written unless every
// selected plan succeeds. --verify does the same without writing and fails on
// any difference from the committed files.
//
// It refuses to run if engine/tj is not the tree pinned in engine/tj.pin.json
// (tracked, untracked and ignored files all count), if Ruby is not 3.4.x
// (ruby.wasm is 3.4; --allow-ruby overrides and each golden records the
// version), if engine/bridge/ or engine/golden/plans/ have uncommitted
// changes, or if native Ruby disagrees with the stable-sort probe or the DST
// edge-case table (tz-edge-cases.json).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
	canonical, canonicalJson, csvRows, diffPaths, expectedRows, firstError, manifestProblems,
	messageDiffs, normaliseMessages, parseCsv, rowDiffs,
} from './lib.mjs';
import { checkTzEdgesNative } from './tz-edges.mjs';

const GOLDEN = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(GOLDEN, '..', '..');
const EXPECTED = path.join(GOLDEN, 'expected');
const TIMINGS = path.join(GOLDEN, 'native-timings.json');
const TJ_LIB = path.join(REPO, 'engine', 'tj', 'lib');
const CROSS_TJI = 'mainspring-cross-check.tji';
const CROSS_CSV = 'mainspring-cross-check.csv';
const MACRO_RE = /^macro mainspring_crosscheck_scenarios \[[^\]]*\]$/m;
const RUN_TIMEOUT_MS = 15 * 60_000;
const ENV = {
	...process.env,
	TZ: 'UTC',
	LANG: 'C.UTF-8',
	LC_ALL: 'C.UTF-8',
	BUNDLE_GEMFILE: path.join(GOLDEN, 'Gemfile'),
};

class Refusal extends Error {}

function run(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, {
		cwd: REPO, env: ENV, encoding: 'utf8', maxBuffer: 1 << 30, timeout: RUN_TIMEOUT_MS, ...opts,
	});
	if (r.error) throw r.error;
	return r;
}

function git(...args) {
	const r = run('git', args);
	if (r.status !== 0) throw new Refusal(`git ${args.join(' ')} failed:\n${r.stderr}`);
	return r.stdout;
}

function preflight(allowRuby) {
	const pin = JSON.parse(fs.readFileSync(path.join(REPO, 'engine', 'tj.pin.json'), 'utf8'));
	const tree = git('rev-parse', 'HEAD:engine/tj').trim();
	if (tree !== pin.tree) throw new Refusal(`engine/tj at HEAD is tree ${tree}; tj.pin.json pins ${pin.tree}`);
	const tjDirty = git('status', '--porcelain', '--ignored', '--untracked-files=all', '--', 'engine/tj');
	if (tjDirty.trim()) throw new Refusal(`engine/tj differs from the pinned tree:\n${tjDirty}`);
	const dirty = git('status', '--porcelain', '--untracked-files=all', '--', 'engine/bridge', 'engine/golden/plans');
	if (dirty.trim()) throw new Refusal(`commit these first; goldens must come from committed inputs:\n${dirty}`);
	const check = run('bundle', ['check']);
	if (check.status !== 0) {
		throw new Refusal(`gems missing; run: BUNDLE_GEMFILE=engine/golden/Gemfile bundle install\n${check.stdout}${check.stderr}`);
	}
	const rv = run('bundle', ['exec', 'ruby', '-e', 'print RUBY_VERSION']);
	if (rv.status !== 0) throw new Refusal(`cannot run ruby under bundle exec:\n${rv.stderr}`);
	const ruby = rv.stdout.trim();
	if (!/^3\.4\./.test(ruby)) {
		if (!allowRuby) throw new Refusal(`Ruby ${ruby}: recording needs Ruby 3.4.x to match ruby.wasm (--allow-ruby overrides, spec 11.7)`);
		console.warn(`warning: recording with Ruby ${ruby}, not 3.4.x (--allow-ruby); native.ruby records it`);
	}
	// Native Ruby must sort ties stably (the browser does, through
	// engine/bridge/wasm/tj_wasm_sort.rb), and that patch, loaded natively,
	// must give exactly the same orders as native Ruby without it.
	const plain = run('bundle', ['exec', 'ruby', '-e', SORT_PROBE]);
	if (plain.status !== 0 || !plain.stdout.endsWith('\nstable\n')) {
		throw new Refusal(`native Ruby does not sort ties stably here (${plain.stdout.trim().split('\n').pop() ?? ''}${plain.stderr.trim()}). ` +
			'TaskJuggler sorts with ties and the browser engine keeps tied elements in order, so record on a ' +
			'glibc-based Linux such as Debian or Ubuntu (not Alpine or macOS)');
	}
	const patched = run('bundle', ['exec', 'ruby', '-r', path.join(REPO, 'engine', 'bridge', 'wasm', 'tj_wasm_sort.rb'),
		'-e', SORT_PROBE]);
	if (patched.stdout !== plain.stdout) {
		const a = plain.stdout.split('\n');
		const b = `${patched.stdout}${patched.stderr}`.split('\n');
		const diffs = a.map((line, i) => (line === b[i] ? null : `native ${line}; patched ${b[i]}`)).filter(Boolean);
		throw new Refusal(`engine/bridge/wasm/tj_wasm_sort.rb changes native sort results:\n  ${diffs.slice(0, 5).join('\n  ')}`);
	}
	console.warn('sort check: native Ruby keeps ties in order, and tj_wasm_sort.rb gives identical orders');
	// The DST edge-case table (tz-edge-cases.json) says how local times at
	// offset changes resolve; engine/bridge/wasm/tj_wasm_tz.rb implements it
	// for the browser. It must hold for the Ruby that records the goldens.
	const tz = checkTzEdgesNative();
	if (tz.diffs.length) {
		throw new Refusal(`native Ruby ${tz.ruby} disagrees with engine/golden/tz-edge-cases.json, so ` +
			`engine/bridge/wasm/tj_wasm_tz.rb no longer matches it:\n  ${tz.diffs.slice(0, 10).join('\n  ')}`);
	}
	console.warn(`tz check: native Ruby gives all ${tz.total} instants of tz-edge-cases.json`);
	return ruby;
}

// Sorts elements with many ties through every path tj_wasm_sort.rb changes:
// Array#sort with a block, with <=>, Array#sort!, Hash#sort, String elements
// (no fast path) and Integer and Symbol elements (fast path). Prints a CRC of
// each resulting order (positions in the input, by object identity), then
// "stable" if every order of distinguishable elements kept ties in input
// order, else "unstable".
const SORT_PROBE = `
require 'zlib'
key = Struct.new(:k, :i) do
  include Comparable
  def <=>(other) = k <=> other.k
end
by_k = ->(a, b) { a.k <=> b.k }
positions = lambda do |sorted, input|
  pos = {}
  input.each_with_index { |x, i| pos[x.object_id] = i }
  sorted.map { |x| pos[x.object_id] }
end
stable = true
[5, 40, 3000].each do |n|
  ks = Array.new(n) { |i| (i * 7919) % 13 }
  items = Array.new(n) { |i| key.new(ks[i], i) }
  strs = ks.map { |k| +format('s%02d', k) }
  ref = Array.new(n) { |i| i }.group_by { |i| ks[i] }.keys.sort.flat_map { |k| (0...n).select { |i| ks[i] == k } }
  {
    'block' => [items.sort(&by_k), items],
    'cmp' => [items.sort, items],
    'bang' => [items.dup.sort!(&by_k), items],
    'hash' => [items.each_with_index.to_h { |x, i| [i, x] }.sort { |a, b| by_k.(a[1], b[1]) }.map(&:last), items],
    'strings' => [strs.sort, strs]
  }.each do |name, (sorted, input)|
    order = positions.(sorted, input)
    stable &&= order == ref
    puts "#{name} #{n} #{Zlib.crc32(order.join(','))}"
  end
  puts "integers #{n} #{Zlib.crc32(ks.sort.join(','))}"
  puts "symbols #{n} #{Zlib.crc32(ks.map { |k| :"k#{format('%02d', k)}" }.sort.join(','))}"
end
puts(stable ? 'stable' : 'unstable')
`;

function loadManifest() {
	const plans = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'manifest.json'), 'utf8'));
	const problems = manifestProblems(plans);
	for (const p of problems.length ? [] : plans) {
		if (!fs.existsSync(path.join(REPO, p.root, p.entry))) problems.push(`${JSON.stringify(p.id)}: missing ${p.root}/${p.entry}`);
	}
	if (problems.length) throw new Refusal(`manifest.json:\n  ${problems.join('\n  ')}`);
	return plans;
}

function recordOnce(plan, workspace) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mainspring-rec-'));
	try {
		const timingsFile = path.join(tmp, 'timings.json');
		const args = ['exec', 'ruby', '-EUTF-8', '-I', 'engine/tj/lib', 'engine/bridge/native/record.rb',
			'--root', plan.root, '--entry', plan.entry, '--id', plan.id, '--timings-out', timingsFile];
		if (plan.now) args.push('--now', plan.now);
		for (const g of plan.files ?? []) args.push('--glob', g);
		if (workspace) args.push('--workspace', workspace);
		const t0 = performance.now();
		const r = run('bundle', args);
		const processMs = performance.now() - t0;
		if (r.status !== 0) throw new Error(`record.rb exited ${r.status ?? r.signal}:\n${r.stderr}`);
		const timings = JSON.parse(fs.readFileSync(timingsFile, 'utf8'));
		return { out: r.stdout, timings: { ...timings, processMs: Math.round(processMs * 10) / 10 } };
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

// Serializer cross-check (spec 6.2, step 5). The real tj3 CLI runs on the
// same workspace with cross-check.tji and cross-check-shim.rb, and must agree
// with the golden on: every task's start and end per active scenario (its CSV
// report), the project's start, end and now, the active scenarios, and every
// message up to the end of scheduling (level, id, file, line, text). When
// neither side parses, tj3 must also exit non-zero.
function crossCheck(plan, result, workspace, tmp) {
	const template = fs.readFileSync(path.join(GOLDEN, 'cross-check.tji'), 'utf8');
	if (!MACRO_RE.test(template)) throw new Error('cross-check.tji lost its scenario macro line');
	const root = fs.realpathSync(workspace);
	if (fs.existsSync(path.join(root, CROSS_TJI))) throw new Error(`${CROSS_TJI} clashes with a plan file`);
	const active = (result.project?.scenarios ?? []).filter((s) => s.active);
	const ids = active.length ? active.map((s) => s.id) : ['plan'];
	fs.writeFileSync(path.join(root, CROSS_TJI),
		template.replace(MACRO_RE, `macro mainspring_crosscheck_scenarios [${ids.join(', ')}]`));
	const outFile = path.join(tmp, 'tj3-state.json');
	const env = { ...ENV, MAINSPRING_TJ3_OUT: outFile, MAINSPRING_CLOCK: plan.now ?? '' };
	const r = run('bundle', ['exec', 'ruby', '-W0', '-EUTF-8', '-I', TJ_LIB,
		'-r', path.join(GOLDEN, 'cross-check-shim.rb'), path.join(REPO, 'engine', 'tj', 'bin', 'tj3'),
		'--silent', '--no-color', '-f', '--report', 'mainspring_crosscheck',
		path.join(root, plan.entry), path.join(root, CROSS_TJI)], { cwd: root, env });
	if (!fs.existsSync(outFile)) throw new Error(`tj3 left no state (exit ${r.status}):\n${r.stderr}`);
	const state = JSON.parse(fs.readFileSync(outFile, 'utf8'));
	const problems = [];

	const msgs = normaliseMessages(state.messages, root);
	problems.push(...messageDiffs(result.messages, msgs));

	const csvPath = path.join(root, CROSS_CSV);
	if (state.scheduled === null) {
		// Parsing failed in tj3, so it never scheduled or reported.
		if (result.tasks.length || result.ok) problems.push('tj3 did not parse, but the serializer has a schedule');
		if (r.status === 0) problems.push('tj3 exited 0 although parsing failed');
		const a = firstError(result.messages);
		const b = firstError(msgs);
		if (!a || !b || a.id !== b.id || a.file !== b.file || a.line !== b.line) {
			problems.push(`first error differs: serializer ${JSON.stringify(a)}; tj3 ${JSON.stringify(b)}`);
		}
		if (problems.length) throw new Error(`cross-check:\n  ${problems.join('\n  ')}`);
		return `agree: neither side parsed (tj3 exit ${r.status}, first error ${a.id} at ${a.file}:${a.line}), ${msgs.length} message(s)`;
	}

	if (state.scheduled !== result.ok) problems.push(`tj3 scheduled=${state.scheduled}, serializer ok=${result.ok}`);
	const p = state.project;
	for (const k of ['start', 'end', 'now']) {
		if (p?.[k] !== result.project?.[k]) problems.push(`project.${k}: serializer ${result.project?.[k]}; tj3 ${p?.[k]}`);
	}
	const tjActive = (p?.scenarios ?? []).filter((s) => s.active).map((s) => s.id).join(', ');
	if (tjActive !== active.map((s) => s.id).join(', ')) {
		problems.push(`active scenarios: serializer [${active.map((s) => s.id)}]; tj3 [${tjActive}]`);
	}
	if (!fs.existsSync(csvPath)) {
		problems.push(`tj3 wrote no CSV (exit ${r.status}): ${r.stderr.trim().split('\n')[0] ?? ''}`);
	} else {
		problems.push(...rowDiffs(expectedRows(result), csvRows(parseCsv(fs.readFileSync(csvPath, 'utf8')))));
	}
	if (problems.length) throw new Error(`cross-check:\n  ${problems.join('\n  ')}`);
	return `agree: ${result.tasks.length} tasks x ${active.length} scenario(s), project frame, ${msgs.length} message(s)`;
}

function processPlan(plan, verify) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mainspring-golden-'));
	try {
		const workspace = path.join(tmp, 'workspace');
		const first = recordOnce(plan, workspace);
		const second = recordOnce(plan, null);
		if (first.out !== second.out) {
			const a = first.out.split('\n');
			const b = second.out.split('\n');
			const i = a.findIndex((line, n) => line !== b[n]);
			throw new Error(`nondeterministic: run 1 and run 2 differ at line ${i + 1}:\n  ${a[i]}\n  ${b[i]}`);
		}
		const golden = canonical(JSON.parse(first.out));
		const text = canonicalJson(golden);
		const cross = crossCheck(plan, golden.result, workspace, tmp);
		const timings = {};
		for (const k of Object.keys(first.timings)) timings[k] = Math.min(first.timings[k], second.timings[k]);
		let verdict = 'recorded';
		if (verify) {
			const file = path.join(EXPECTED, `${plan.id}.json`);
			if (!fs.existsSync(file)) throw new Error(`no committed ${path.relative(REPO, file)}`);
			const committed = fs.readFileSync(file, 'utf8');
			if (committed !== text) {
				const diffs = diffPaths(JSON.parse(committed), golden);
				const onlyNative = diffs.length > 0 && diffs.every((d) => d.startsWith('/native/'));
				throw new Error(`differs from the committed golden${onlyNative ? ' (native.* metadata only)' : ''}:\n  ${diffs.join('\n  ') || '(formatting only)'}`);
			}
			verdict = 'matches';
		}
		return { text, golden, timings, cross, verdict };
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

function main() {
	const { values } = parseArgs({
		options: {
			verify: { type: 'boolean', default: false },
			only: { type: 'string', multiple: true, default: [] },
			'allow-ruby': { type: 'boolean', default: false },
			help: { type: 'boolean', default: false },
		},
	});
	if (values.help) {
		console.log('usage: node engine/golden/record-native.mjs [--verify] [--only <id>]... [--allow-ruby]');
		return 0;
	}
	const verify = values.verify;
	const ruby = preflight(values['allow-ruby']);
	const manifest = loadManifest();
	const unknown = values.only.filter((id) => !manifest.some((p) => p.id === id));
	if (unknown.length) throw new Refusal(`--only: unknown plan id(s) ${unknown.join(', ')}`);
	const plans = values.only.length ? manifest.filter((p) => values.only.includes(p.id)) : manifest;

	const done = [];
	const failures = [];
	for (const plan of plans) {
		process.stderr.write(`${plan.id} ... `);
		try {
			const res = processPlan(plan, verify);
			done.push({ plan, ...res });
			const r = res.golden.result;
			const t = res.timings;
			process.stderr.write(`${res.verdict}; ok=${r.ok} tasks=${r.tasks.length} messages=${r.messages.length}; ` +
				`parse ${t.parseMs} + schedule ${t.scheduleMs} + serialize ${t.serializeMs} ms (process ${t.processMs} ms); ${res.cross}\n`);
		} catch (e) {
			failures.push(plan.id);
			process.stderr.write(`FAILED\n${e.message}\n`);
		}
	}

	const stale = fs.existsSync(EXPECTED)
		? fs.readdirSync(EXPECTED).filter((f) => f.endsWith('.json') && !manifest.some((p) => `${p.id}.json` === f))
		: [];
	if (verify && stale.length) failures.push(...stale.map((f) => `stale expected/${f}`));
	if (failures.length) {
		console.error(`\n${failures.length} failure(s): ${failures.join(', ')}${verify ? '' : '; nothing written'}`);
		return 1;
	}
	if (verify) {
		console.error(`\nall ${done.length} plan(s) reproduce the committed goldens`);
		return 0;
	}

	fs.mkdirSync(EXPECTED, { recursive: true });
	for (const { plan, text } of done) fs.writeFileSync(path.join(EXPECTED, `${plan.id}.json`), text);
	if (!values.only.length) for (const f of stale) fs.rmSync(path.join(EXPECTED, f));
	const previous = values.only.length && fs.existsSync(TIMINGS) ? JSON.parse(fs.readFileSync(TIMINGS, 'utf8')).plans : {};
	const plansTimings = { ...previous };
	for (const { plan, golden, timings } of done) plansTimings[plan.id] = { tasks: golden.result.tasks.length, ...timings };
	const ordered = Object.fromEntries(manifest.filter((p) => plansTimings[p.id]).map((p) => [p.id, plansTimings[p.id]]));
	const timingsDoc = {
		note: 'Native wall-clock times in ms from golden:record (minimum of the two runs). Never compared. ' +
			'parse/schedule/serialize/total are measured inside Ruby; processMs includes Ruby and TaskJuggler start-up.',
		platform: `${os.platform()}-${os.arch()}`,
		ruby,
		plans: ordered,
	};
	fs.writeFileSync(TIMINGS, `${JSON.stringify(timingsDoc, null, 2)}\n`);
	console.error(`\nwrote ${done.length} golden(s)${stale.length && !values.only.length ? `, removed ${stale.join(', ')}` : ''}, native-timings.json`);
	return 0;
}

try {
	process.exitCode = main();
} catch (e) {
	if (!(e instanceof Refusal)) throw e;
	console.error(`refusing to run: ${e.message}`);
	process.exitCode = 2;
}
