// Generates engine/golden/plans/fedora-res/ (phase-3 spec 18.1, 19.1):
//   - a copy of upstream Fedora 20 (engine/tj/examples/Fedora-20), file for file, with one
//     `include "mainspring-load.tji"` appended to the copy of f-20.tjp;
//   - mainspring-load.tji: 24 people in 4 groups, one part-timer, one person at efficiency 0.8,
//     global holidays, personal leaves of every type, and `supplement task` blocks that allocate
//     people to about 150 Fedora leaves.
// Deterministic: a seeded mulberry32 PRNG, no Math.random, no clock. Run from anywhere:
//   node engine/golden/generators/fedora-res.mjs
// Check mode (exit 1 if any committed file differs from what the script would write):
//   node engine/golden/generators/fedora-res.mjs --check
// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const UPSTREAM = join(REPO, 'engine', 'tj', 'examples', 'Fedora-20');
const OUT = join(REPO, 'engine', 'golden', 'plans', 'fedora-res');
const LOAD = 'mainspring-load.tji';
const INCLUDE_LINE = `include "${LOAD}"`;
const SEED = 0x0fed20a1;
const ALLOCATED = 150;

function mulberry32(a) {
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rnd = mulberry32(SEED);
const pick = (n) => Math.floor(rnd() * n);

/**
 * Leaf tasks of Fedora 20 (a task with `length` or `duration` and no subtask) with their full
 * ids. The top task's id is the macro `${content}${major}`, which expands to f20. Comments and
 * strings are removed before the braces are counted.
 * @param {string} text
 * @returns {string[]}
 */
export function fedoraLeaves(text) {
	/** @type {{ task: string | null, child: boolean, leaf: boolean }[]} */
	const stack = [];
	const leaves = [];
	let inComment = false;
	for (const raw of text.split('\n')) {
		let line = raw.replace(/"[^"]*"/g, '""').replace(/\$\{content\}\$\{major\}/g, 'f20');
		if (inComment) {
			const end = line.indexOf('*/');
			if (end < 0) continue;
			line = line.slice(end + 2);
			inComment = false;
		}
		line = line.replace(/\/\*.*?\*\//g, '');
		const open = line.indexOf('/*');
		if (open >= 0) {
			line = line.slice(0, open);
			inComment = true;
		}
		const hash = line.indexOf('#');
		if (hash >= 0) line = line.slice(0, hash);

		const taskOpen = /^\s*task\s+([A-Za-z0-9_]+)\s+""\s*\{/.exec(line);
		if (taskOpen) {
			const parent = [...stack].reverse().find((e) => e.task !== null);
			if (parent) parent.child = true;
			stack.push({ task: taskOpen[1], child: false, leaf: false });
		} else if (stack.length && /^\s*(length|duration)\b/.test(line) && stack[stack.length - 1].task) {
			stack[stack.length - 1].leaf = true;
		}
		const rest = taskOpen ? line.slice(taskOpen[0].length) : line;
		for (const ch of rest) {
			if (ch === '{') stack.push({ task: null, child: false, leaf: false });
			else if (ch === '}') {
				const top = stack.pop();
				if (top?.task && top.leaf && !top.child) {
					const path = [...stack, top].filter((e) => e.task).map((e) => e.task);
					leaves.push(path.join('.'));
				}
			}
		}
	}
	return leaves;
}

const GROUPS = [
	{ id: 'desk', name: 'Desktop' },
	{ id: 'server', name: 'Server' },
	{ id: 'docs', name: 'Documentation' },
	{ id: 'qa', name: 'Quality' },
];
const PER_GROUP = 6;

/** Person ids: 4 groups of 6, in group order. */
function people() {
	const out = [];
	for (const g of GROUPS) {
		for (let i = 1; i <= PER_GROUP; i++) {
			out.push({ group: g, id: `${g.id}${String(i).padStart(2, '0')}` });
		}
	}
	return out;
}

const HOLIDAYS = [
	['Memorial Day', '2013-05-27'],
	['Independence Day', '2013-07-04'],
	['Labor Day', '2013-09-02'],
	['Thanksgiving', '2013-11-28'],
	['Christmas', '2013-12-25'],
	['New Year', '2014-01-01'],
	['Memorial Day 2014', '2014-05-26'],
	['Independence Day 2014', '2014-07-04'],
];

/** Personal leaves, one per type plus a second annual leave: [type, person index, start, end]. */
const LEAVES = [
	['annual', 3, '2013-06-10', '2013-06-14'],
	['annual', 9, '2013-10-07', '2013-10-11'],
	['special', 14, '2013-08-19', '2013-08-20'],
	['sick', 20, '2013-07-22', '2013-07-24'],
	['unpaid', 5, '2013-11-04', '2013-11-08'],
	['unemployed', 17, '2013-06-03', '2013-06-07'],
	['project', 11, '2013-12-02', '2013-12-06'],
];

/** The part-timer and the efficiency-0.8 person, by person index. */
const PART_TIMER = 18;
const EFFICIENT = 2;

/** @returns {string} the text of mainspring-load.tji */
export function loadText(leafIds) {
	const ppl = people();
	const out = [];
	const w = (s = '') => out.push(s);
	w('# Feature: resource pool and supplement allocations for the Fedora 20 gate (phase-3 spec 18.1, 19.1)');
	w('# Generated by engine/golden/generators/fedora-res.mjs (seed 0x0fed20a1). Do not hand-edit; regenerate with the script.');
	w('# 24 people in 4 groups; one part-timer (mon - fri 9:00 - 13:00), one at efficiency 0.8; global holidays; personal leaves of every type; supplements allocate people to Fedora leaves.');
	w('# SPDX-License-Identifier: GPL-2.0-or-later');
	w();
	for (const [name, date] of HOLIDAYS) w(`leaves holiday "${name}" ${date}`);
	w();
	for (const g of GROUPS) {
		w(`resource ${g.id} "${g.name}" {`);
		ppl.filter((p) => p.group === g).forEach((p) => {
			const idx = ppl.indexOf(p);
			const body = [];
			if (idx === PART_TIMER) body.push('    workinghours mon - fri 9:00 - 13:00');
			if (idx === EFFICIENT) body.push('    efficiency 0.8');
			for (const [type, who, start, end] of LEAVES) {
				if (who === idx) body.push(`    leaves ${type} "${type} leave" ${start} - ${end}`);
			}
			const name = `${g.name} ${String(idx % PER_GROUP + 1).padStart(2, '0')}`;
			if (body.length) {
				w(`  resource ${p.id} "${name}" {`);
				for (const line of body) w(line);
				w('  }');
			} else {
				w(`  resource ${p.id} "${name}"`);
			}
		});
		w('}');
		w();
	}
	// Shuffle the leaves, keep the first ALLOCATED, and write them in Fedora's order.
	const order = leafIds.map((id, i) => ({ id, i, k: rnd() }));
	const chosen = [...order].sort((a, b) => a.k - b.k).slice(0, ALLOCATED).sort((a, b) => a.i - b.i);
	for (const { id } of chosen) {
		const two = rnd() < 0.3;
		const a = ppl[pick(ppl.length)].id;
		let b = ppl[pick(ppl.length)].id;
		while (two && b === a) b = ppl[pick(ppl.length)].id;
		w(`supplement task ${id} {`);
		w(`  allocate ${two ? `${a}, ${b}` : a}`);
		w('}');
	}
	return `${out.join('\n')}\n`;
}

/** The copy of upstream Fedora 20: every file as upstream, f-20.tjp with the include appended. */
function copyText(name) {
	const text = readFileSync(join(UPSTREAM, name));
	if (name !== 'f-20.tjp') return text;
	const body = text.toString('utf8');
	const sep = body.endsWith('\n') ? '' : '\n';
	return Buffer.from(`${body}${sep}${INCLUDE_LINE}\n`, 'utf8');
}

function upstreamFiles() {
	return readdirSync(UPSTREAM, { recursive: true, withFileTypes: false })
		.map(String)
		.filter((p) => !p.endsWith('/') && existsSync(join(UPSTREAM, p)) && !isDir(join(UPSTREAM, p)))
		.sort();
}

function isDir(p) {
	return statSync(p).isDirectory();
}

/** Every output file as [relative path, Buffer]. */
export function outputs() {
	const leaves = fedoraLeaves(readFileSync(join(UPSTREAM, 'f-20.tjp'), 'utf8'));
	const files = upstreamFiles().map((p) => [p, copyText(p)]);
	files.push([LOAD, Buffer.from(loadText(leaves), 'utf8')]);
	return files;
}

const check = process.argv.includes('--check');
const files = outputs();
if (check) {
	const bad = [];
	for (const [p, buf] of files) {
		const file = join(OUT, p);
		if (!existsSync(file) || !readFileSync(file).equals(buf)) bad.push(p);
	}
	if (bad.length) {
		console.error(`fedora-res: out of date: ${bad.join(', ')} (run node engine/golden/generators/fedora-res.mjs)`);
		process.exit(1);
	}
	console.log(`fedora-res: ${files.length} files match the generator`);
} else {
	for (const [p, buf] of files) {
		const file = join(OUT, p);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, buf);
	}
	console.log(`fedora-res: wrote ${files.length} files to ${OUT}`);
}
