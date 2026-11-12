// SPDX-License-Identifier: GPL-2.0-or-later
// What the index must treat as unsafe because TaskJuggler reads the text differently from the
// tree: macro bodies that reshape the text they are spliced into (Scanner.rb:78-90), macros
// that redefine others (MacroTable#add), stale and disagreeing engine hints. The native results
// quoted were recorded with TaskJuggler 3.8.4 in the T8 review.
import { describe, expect, it } from 'vitest';
import { buildIndex, lastSite } from './index';
import { structuralRisk } from './scan-items';
import { inline } from './testing';
import type { EngineHints, SymbolIndex } from './types';

const P = 'project p "P" 2026-01-05 +2m\n';
const build = (text: string, hints?: EngineHints) =>
	buildIndex(inline({ 'plan.tjp': text }).snapshot(), hints, { cache: null });
const blockOf = (idx: SymbolIndex, id: string) => {
	const b = idx.tasks.get(id)?.decl.block;
	return b ? idx.blocking('plan.tjp', b.from, b.to) : undefined;
};

describe('structuralRisk', () => {
	it('flags braces that do not balance, comment starts and unterminated tokens', () => {
		expect(structuralRisk(' } ')).toBe('braces');
		expect(structuralRisk(' { ')).toBe('braces');
		expect(structuralRisk(' } { ')).toBe('braces');
		expect(structuralRisk(' # ')).toBe('comment');
		expect(structuralRisk(' // x')).toBe('comment');
		expect(structuralRisk(' /* x */ ')).toBe('comment');
		expect(structuralRisk(' "abc ')).toBe('unterminated');
		expect(structuralRisk(' -8<-\nx\n')).toBe('unterminated');
		expect(structuralRisk(' allocate r { alternative s } ')).toBeNull();
		expect(structuralRisk(' note "a # b { c" ')).toBeNull();
	});
});

describe('statement-level macro calls (H1, M2)', () => {
	// native1: TaskJuggler declares a top-level `b` with length 1d, `a` with no length, and
	// comments out x's length.
	const native1 = `${P}macro close [ } ]\nmacro open [ { ]\nmacro c [ # ]\ntask a "A" { \${close} task b "B" \${open} length 1d }\ntask x "X" { \${c} length 5d\n}\n`;

	it('treats calls whose bodies reshape the text as unsafe', () => {
		const idx = build(native1);
		expect(blockOf(idx, 'a')?.reason).toBe('macro-call');
		expect(blockOf(idx, 'a.b')?.reason).toBe('macro-call');
		expect(blockOf(idx, 'x')?.reason).toBe('macro-call');
	});

	it('marks a declaration whose header line the engine read with other ids', () => {
		const hints: EngineHints = {
			tasks: [
				{ id: 'a', parent: null, file: 'plan.tjp', line: 5 },
				{ id: 'b', parent: null, file: 'plan.tjp', line: 5 },
				{ id: 'x', parent: null, file: 'plan.tjp', line: 6 },
			],
			resources: [],
		};
		const idx = build(native1, hints);
		expect(idx.tasks.get('a')?.textOnly).toBeNull();
		expect(idx.tasks.get('a.b')?.textOnly?.reason).toBe('macro-call');
		expect(idx.tasks.has('b')).toBe(false);
	});

	it('treats every call as unsafe when some macro body defines a macro (native3: t.z)', () => {
		const native3 = `${P}macro inner [ priority 600 ]\nmacro outer [macro inner [ task z "Z" ]]\n\${outer}\ntask t "T" {\n  \${inner}\n  \${?opt}\n}\n`;
		const idx = build(native3);
		// The grammar reads `${?opt}` as an argument of the `${inner}` call statement.
		const t = idx.tasks.get('t');
		expect(t?.bodyMacroCalls).toHaveLength(1);
		const call = t?.bodyMacroCalls[0];
		const ranges = idx.textOnly('plan.tjp');
		expect(ranges.some((r) => r.within === null && r.at.from === call?.from)).toBe(true);
		expect(blockOf(idx, 't')?.reason).toBe('macro-call');
		// Without the redefining macro, the same call is harmless.
		const harmless = build(`${P}macro inner [ priority 600 ]\ntask t "T" {\n  \${inner}\n}\n`);
		expect(blockOf(harmless, 't')).toBeNull();
	});

	it('treats an optional call of a macro defined nowhere as safe', () => {
		const idx = build(`${P}task t "T" {\n  \${?absent}\n  length 1d\n}\n`);
		expect(blockOf(idx, 't')).toBeNull();
		const unsafe = build(`${P}task t "T" {\n  \${absent}\n  length 1d\n}\n`);
		expect(blockOf(unsafe, 't')?.reason).toBe('macro-call');
	});
});

describe('engine hints (M3, L6)', () => {
	const text = `${P}macro y [yy]\ntask \${y} "Y"\n`;

	it('ignores a hint whose fingerprint no longer matches its line', () => {
		const stale: EngineHints = {
			tasks: [{ id: 'xx', parent: null, file: 'plan.tjp', line: 3, text: 'task ${x} "X"' }],
			resources: [],
		};
		const idx = build(text, stale);
		expect(idx.tasks.size).toBe(0);
		expect(idx.unresolved.map((u) => [u.reason, u.candidates])).toEqual([['macro-id', 0]]);
		const current: EngineHints = {
			tasks: [{ id: 'yy', parent: null, file: 'plan.tjp', line: 3, text: 'task ${y} "Y"' }],
			resources: [],
		};
		expect([...build(text, current).tasks.keys()]).toEqual(['yy']);
	});

	it('drops a leftover hint on a line without a statement-level macro call', () => {
		const hints: EngineHints = {
			tasks: [{ id: 'ghost', parent: null, file: 'plan.tjp', line: 1 }],
			resources: [],
		};
		const idx = build(`${P}task a "A"\n`, hints);
		expect([...idx.tasks.keys()]).toEqual(['a']);
		expect(idx.textOnly('plan.tjp').some((r) => r.reason === 'expanded-only')).toBe(false);
	});
});

describe('lastSite and the top scenario (L5)', () => {
	it('reads a prefix naming the top scenario as no prefix (native2: 2026-01-08)', () => {
		const idx = build(
			'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" { scenario alt "Alt" }\n}\ntask s "S" { length 1d start 2026-01-06 plan:start 2026-01-08 }\n',
		);
		const top = idx.scenarios[0]?.id ?? null;
		const site = lastSite(idx.tasks.get('s')?.attrs ?? [], 'start', null, top);
		expect(site?.scenario).toBe('plan');
		expect(lastSite(idx.tasks.get('s')?.attrs ?? [], 'start', 'plan', top)).toBe(site);
		expect(lastSite(idx.tasks.get('s')?.attrs ?? [], 'start')?.scenario).toBeNull();
	});
});

describe('settings written as macros (L7)', () => {
	it('makes the setting unknown from there on', () => {
		const text =
			'project p "P" 2026-01-05 +2m {\n  dailyworkinghours ${h}\n  timezone "${tz}"\n}\ntask a "A"\n';
		const idx = build(text);
		const at = (s: string) => idx.contextAt('plan.tjp', text.indexOf(s));
		expect([...at('dailyworkinghours').unknown]).toEqual([]);
		expect([...at('timezone').unknown]).toEqual(['dailyWorkingHours']);
		const late = at('task a');
		expect([...late.unknown].sort()).toEqual(['dailyWorkingHours', 'zone']);
		expect(late.granularity).toBe(60);
		const header = build(`project p "P" \${start} +2m\ntask a "A"\n`);
		expect([...header.contextAt('plan.tjp', 40).unknown]).toEqual(['frame']);
	});
});
