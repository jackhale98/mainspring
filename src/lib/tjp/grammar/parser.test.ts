// SPDX-License-Identifier: GPL-2.0-or-later
// Tree shapes of the TJP grammar (phase-1.md 5.2, 5.3): typed MVP statements, opaque statements,
// statement heads, top contexts, macros and errors.
import { describe, expect, it } from 'vitest';
import { KEYWORDS, type TopContextName } from '../syntax/keywords';
import { errorNodes, printLeaves } from '../../../../tests/grammar/corpus';
import {
	isRecoveryStatement,
	MACRO_TOKENS,
	OPAQUE_STATEMENTS,
	TYPED_KEYWORD_IDS,
	TYPED_STATEMENTS,
	tjpGlobalParser,
	tjpParser,
	typedStatementOf,
} from './parser';

const shape = (text: string, top: TopContextName = 'global'): string =>
	tjpParser(top).parse(text).toString();

/** [what, text, top context, expected tree]. */
const SHAPES: [string, string, TopContextName, string][] = [
	[
		'project',
		'project p "P" "1.0" 2024-01-01 +1m { timezone "UTC" now 2024-01-02 }',
		'global',
		'File(ProjectStatement(Keyword,Id(Identifier),Name(String),Version(String),Interval(Date,Plus,Integer,Unit),Body(OpenBrace,TimezoneStatement(Keyword,String),NowStatement(Keyword,Date),CloseBrace)))',
	],
	[
		'project macro',
		'project ${a}${b} "${n}"\n"${v}" ${s} - ${e} {\n}',
		'global',
		'File(ProjectStatement(Keyword,Id(MacroWord),Name(TemplateString),Version(TemplateString),Interval(MacroCall,Minus,MacroCall),Body(OpenBrace,CloseBrace)))',
	],
	[
		'task',
		'task t "T" {\n  effort 5d\n  length 2.5 h\n  duration 1w\n  start 2024-01-01\n  end %{2024-02-01 - 1d}\n}',
		'global',
		'File(TaskStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,EffortStatement(Keyword,WorkingDuration(Integer,Unit)),LengthStatement(Keyword,WorkingDuration(Float,Unit)),DurationStatement(Keyword,CalendarDuration(Integer,Unit)),StartStatement(Keyword,Date),EndStatement(Keyword,DateExpr(Percent,OpenBrace,Date,Minus,Integer,Unit,CloseBrace)),CloseBrace)))',
	],
	['task noid', 'task "T"', 'global', 'File(TaskStatement(Keyword,Name(String)))'],
	[
		'task macro id',
		'task ${id} "T" { }',
		'global',
		'File(TaskStatement(Keyword,Id(MacroCall),Name(String),Body(OpenBrace,CloseBrace)))',
	],
	[
		'deps',
		'task a "A" { depends !b, !!c.d { gapduration 2d onend }, e precedes f }',
		'global',
		'File(TaskStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,DependsStatement(Keyword,DepItem(TaskRef(Bang,Identifier)),Comma,DepItem(TaskRef(Bang,Bang,AbsoluteId),Body(OpenBrace,GapdurationStatement(Keyword,CalendarDuration(Integer,Unit)),OnendStatement(Keyword),CloseBrace)),Comma,DepItem(TaskRef(Identifier))),PrecedesStatement(Keyword,DepItem(TaskRef(Identifier))),CloseBrace)))',
	],
	[
		'alloc',
		'task a "A" { allocate r1 { alternative r2, r3 select order }, r4 }',
		'global',
		'File(TaskStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,AllocateStatement(Keyword,AllocItem(ResourceRef(Identifier),Body(OpenBrace,OpaqueStatement(Keyword,Identifier,Comma,Identifier),OpaqueStatement(Keyword,Identifier),CloseBrace)),Comma,AllocItem(ResourceRef(Identifier))),CloseBrace)))',
	],
	[
		'flags',
		'flags x, y\ntask a "A" { flags x milestone priority 500 complete 50 note "n" scheduling alap responsible r1, r2 }',
		'global',
		'File(FlagsStatement(Keyword,Flag(Identifier),Comma,Flag(Identifier)),TaskStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,FlagsStatement(Keyword,Flag(Identifier)),MilestoneStatement(Keyword),PriorityStatement(Keyword,Integer),CompleteStatement(Keyword,Integer),NoteStatement(Keyword,String),SchedulingStatement(Keyword,Identifier),ResponsibleStatement(Keyword,ResourceRef(Identifier),Comma,ResourceRef(Identifier)),CloseBrace)))',
	],
	[
		'leaves',
		'leaves holiday "X" 2024-12-25 +2d, annual 2024-07-01 - 2024-07-15\nvacation "V" 2024-01-01, 2024-02-01 +1w',
		'global',
		'File(LeavesStatement(Keyword,Leave(LeaveType(Identifier),Name(String),Interval(Date,Plus,Integer,Unit)),Comma,Leave(LeaveType(Identifier),Interval(Date,Minus,Date))),VacationStatement(Keyword,Name(String),Interval(Date),Comma,Interval(Date,Plus,Integer,Unit)))',
	],
	[
		'resource',
		'resource r "R" { efficiency 1.0 rate 300 email "a@b" managers boss leaves sick 2024-01-02 workinghours mon - fri 9:00 - 12:00, 13:00 - 17:00 workinghours sat, sun off vacation 2024-03-01 }',
		'global',
		'File(ResourceStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,EfficiencyStatement(Keyword,Float),RateStatement(Keyword,Integer),EmailStatement(Keyword,String),ManagersStatement(Keyword,ResourceRef(Identifier)),LeavesStatement(Keyword,Leave(LeaveType(Identifier),Interval(Date))),WorkinghoursStatement(Keyword,WeekdayRange(Identifier,Minus,Identifier),TimeInterval(Time,Minus,Time),Comma,TimeInterval(Time,Minus,Time)),WorkinghoursStatement(Keyword,WeekdayRange(Identifier),Comma,WeekdayRange(Identifier),Identifier),VacationStatement(Keyword,Interval(Date)),CloseBrace)))',
	],
	[
		'supplement',
		'supplement task a { effort 1d }\nsupplement resource r { rate 2 }\nresource q "Q" { supplement r { rate 3 } }',
		'global',
		'File(SupplementStatement(Keyword,SupplementKind,Ref(Identifier),Body(OpenBrace,EffortStatement(Keyword,WorkingDuration(Integer,Unit)),CloseBrace)),SupplementStatement(Keyword,SupplementKind,Ref(Identifier),Body(OpenBrace,RateStatement(Keyword,Integer),CloseBrace)),ResourceStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,SupplementStatement(Keyword,Ref(Identifier),Body(OpenBrace,RateStatement(Keyword,Integer),CloseBrace)),CloseBrace)))',
	],
	[
		'include',
		'include "a.tji" { taskprefix p }\nmacro m [ effort 1d ]\n',
		'global',
		'File(IncludeStatement(Keyword,String,Body(OpenBrace,OpaqueStatement(Keyword,Identifier),CloseBrace)),MacroStatement(Keyword,Identifier,MacroBody))',
	],
	[
		'scenario prefix',
		'task a "A" { delayed:effort 2d plan:Cost 5 }',
		'global',
		'File(TaskStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,EffortStatement(ScenarioPrefix,Keyword,WorkingDuration(Integer,Unit)),ExtensionStatement(ScenarioPrefix,AttributeName,Integer),CloseBrace)))',
	],
	[
		'extension',
		'project p "P" 2024-01-01 +1m { extend task { text Phone "Phone" } }\ntask a "A" { Phone "x" { label "y" } }',
		'global',
		'File(ProjectStatement(Keyword,Id(Identifier),Name(String),Interval(Date,Plus,Integer,Unit),Body(OpenBrace,OpaqueStatement(Keyword,Identifier,Body(OpenBrace,OpaqueStatement(Keyword,Identifier,String),CloseBrace)),CloseBrace)),TaskStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,ExtensionStatement(AttributeName,String,Body(OpenBrace,OpaqueStatement(Identifier,String),CloseBrace)),CloseBrace)))',
	],
	[
		'macro stmt',
		'task a "A" {\n  ${alloc}\n  effort ${len}\n  ${x "y"}\n}',
		'global',
		'File(TaskStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,MacroCallStatement(MacroCall),EffortStatement(Keyword,WorkingDuration(MacroCall)),MacroCallStatement(MacroCall),CloseBrace)))',
	],
	[
		'opaque',
		'taskreport r "R" { formats html columns start, name, end { title "E" } hidetask ~isleaf() & (plan.start > %{${now} - 1w}) period %{${now} - 1w} +1w }',
		'global',
		'File(OpaqueStatement(Keyword,Identifier,String,Body(OpenBrace,OpaqueStatement(Keyword,Identifier),OpaqueStatement(Keyword,Identifier,Comma,Identifier,Comma,Identifier,Body(OpenBrace,OpaqueStatement(Keyword,String),CloseBrace)),OpaqueStatement(Keyword,Punct,Identifier,Group(OpenParen,CloseParen),Punct,Group(OpenParen,AbsoluteId,Punct,DateExpr(Percent,OpenBrace,MacroCall,Minus,Integer,Unit,CloseBrace),CloseParen)),OpaqueStatement(Keyword,DateExpr(Percent,OpenBrace,MacroCall,Minus,Integer,Unit,CloseBrace),Plus,Integer,Identifier),CloseBrace)))',
	],
	[
		'opaque kwargs',
		'task a "A" { purge flags booking r 2024-01-01 +4h { sloppy 2 } }',
		'global',
		'File(TaskStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,OpaqueStatement(Keyword,Identifier),OpaqueStatement(Keyword,Identifier,Date,Plus,Integer,Identifier,Body(OpenBrace,OpaqueStatement(Keyword,Integer),CloseBrace)),CloseBrace)))',
	],
	[
		'unknown body',
		'supplement report r { title "x" columns name }',
		'global',
		'File(SupplementStatement(Keyword,SupplementKind,Ref(Identifier),Body(OpenBrace,OpaqueStatement(Identifier,String,Identifier,Identifier),CloseBrace)))',
	],
	[
		'extras',
		'resource r "R" { leaveallowances annual 2024-01-01 20d shift s1 }',
		'global',
		'File(ResourceStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,OpaqueStatement(Keyword,Identifier,Date,Integer,Identifier),OpaqueStatement(Keyword,Identifier),CloseBrace)))',
	],
	[
		'project top',
		'timezone "UTC"\ninclude "x.tji"',
		'project',
		'File(TimezoneStatement(Keyword,String),IncludeStatement(Keyword,String))',
	],
	[
		'prolog top',
		'macro m [x]\ninclude "y.tji"',
		'prolog',
		'File(MacroStatement(Keyword,Identifier,MacroBody),IncludeStatement(Keyword,String))',
	],
	[
		'comments',
		'# c\ntask a "A" /* b */ { // d\n}',
		'global',
		'File(LineComment,TaskStatement(Keyword,Id(Identifier),Name(String),BlockComment,Body(OpenBrace,LineComment,CloseBrace)))',
	],
];

describe('tree shapes', () => {
	it.each(SHAPES)('%s', (_name, text, top, tree) => {
		const parsed = tjpParser(top).parse(text);
		expect(parsed.toString()).toBe(tree);
		expect(errorNodes(parsed, text)).toEqual([]);
		expect(printLeaves(parsed, text)).toBe(text);
	});
});

/** The names of the leaves, in order. */
function leafNames(text: string, top: TopContextName = 'global'): string[] {
	const out: string[] = [];
	tjpParser(top)
		.parse(text)
		.iterate({
			enter(n) {
				if (!n.node.firstChild) out.push(`${n.name}:${text.slice(n.from, n.to)}`);
			},
		});
	return out;
}

describe('keywords', () => {
	it('are keywords only where the context has them', () => {
		// `start` is a task keyword, a column id after `columns` and after `,` in a report.
		expect(leafNames('taskreport r "" { columns start, end }')).toEqual([
			'Keyword:taskreport',
			'Identifier:r',
			'String:""',
			'OpenBrace:{',
			'Keyword:columns',
			'Identifier:start',
			'Comma:,',
			'Identifier:end',
			'CloseBrace:}',
		]);
	});

	it('are not keywords in a typed value slot', () => {
		// A task called `effort`, a dependency on a task called `allocate`, a leave of type project.
		expect(shape('task effort "E" { depends allocate }\nleaves project 2024-01-01')).toBe(
			'File(TaskStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,' +
				'DependsStatement(Keyword,DepItem(TaskRef(Identifier))),CloseBrace)),' +
				'LeavesStatement(Keyword,Leave(LeaveType(Identifier),Interval(Date))))',
		);
	});

	it('end an opaque statement, unless the keyword before needs an argument', () => {
		expect(shape('task t "T" { purge effort effort 1d }')).toBe(
			'File(TaskStatement(Keyword,Id(Identifier),Name(String),Body(OpenBrace,' +
				'OpaqueStatement(Keyword,Identifier),EffortStatement(Keyword,WorkingDuration(Integer,Unit)),' +
				'CloseBrace)))',
		);
	});

	it('resolve with the context each body opens', () => {
		// `onend` is a keyword in a depends body only; `supplement task` opens a task body.
		expect(
			leafNames('supplement task t { depends a { onend } }').filter((l) => /^K/.test(l)),
		).toEqual(['Keyword:supplement', 'Keyword:depends', 'Keyword:onend']);
		expect(shape('task t "T" { onend }')).toContain('⚠');
	});

	it('take the scoped id of their context', () => {
		// `flags` in a report is opaque; in a task it is typed.
		expect(shape('taskreport r "" { flags x }')).toContain('OpaqueStatement(Keyword,Identifier)');
		expect(shape('task t "T" { flags x }')).toContain('FlagsStatement(Keyword,Flag(Identifier))');
	});

	it('include deprecated keywords the reference leaves out', () => {
		expect(shape('scenario plan "P" { projection { strict } disabled }', 'project')).toBe(
			'File(OpaqueStatement(Keyword,Identifier,String,Body(OpenBrace,' +
				'OpaqueStatement(Keyword,Body(OpenBrace,OpaqueStatement(Keyword),CloseBrace)),' +
				'OpaqueStatement(Keyword),CloseBrace)))',
		);
	});
});

describe('top contexts', () => {
	it('read project attributes at the top of a file included in the header', () => {
		expect(shape('now 2024-01-01', 'project')).toBe('File(NowStatement(Keyword,Date))');
		expect(shape('now 2024-01-01', 'global')).toContain('⚠');
	});

	it('accept only macros and includes in the prolog', () => {
		const text = 'task a "A"';
		const tree = tjpParser('prolog').parse(text);
		expect(errorNodes(tree, text)[0]?.from).toBe(0);
	});

	it('share one parser per top context', () => {
		expect(tjpParser()).toBe(tjpGlobalParser);
		expect(tjpParser('prolog')).toBe(tjpParser('prolog'));
		expect(tjpParser('prolog')).not.toBe(tjpParser('project'));
	});
});

describe('errors', () => {
	it.each([
		['an unknown attribute', 'task a "A" {\n  colour "red"\n}', 2],
		['an unterminated string', 'task a "A" {\n  note "x\n}\n', 2],
		['a stray value', 'task a "A" {\n  effort 1d\n  "x"\n}', 3],
		['an unbalanced brace', 'task a "A" {\n}\n}\n', 3],
		['a missing unit', 'task a "A" {\n  effort 5\n}', 3],
		['a typo after an opaque body', 'task a "A" {\n  limits { dailymax 4h }\n  efort 5d\n}', 3],
		['a typo after a body on one line', 'task a "A" { limits { dailymax 4h } efort 5d }', 1],
		['a typo after a typed statement', 'task a "A" {\n  effort 1d\n  effrot 5d\n}', 3],
		['a second value after a typed statement', 'task a "A" {\n  effort 5d 3h\n}', 2],
		// TaskJuggler accepts only `leaveallowances` (TjpSyntaxRules.rb, rule_leaveAllowances).
		[
			'the documentation id instead of the keyword',
			'resource r "R" {\n  leaveallowance annual 2024-01-01 20d\n}',
			2,
		],
	])('puts the first error node at %s', (_what, text, line) => {
		const tree = tjpGlobalParser.parse(text);
		const errors = errorNodes(tree, text);
		expect(errors[0]?.line).toBe(line);
		expect(printLeaves(tree, text)).toBe(text);
	});

	it.each([
		['a comma list', 'taskreport r "" {\n  columns name,\n    start\n}'],
		['a comma list after a body', 'taskreport r "" {\n  columns name { title "N" },\n    end\n}'],
		['a dependency list', 'task a "A" {\n  depends b,\n    c\n}\ntask b "B"\ntask c "C"'],
		['a working-hours list', 'resource r "R" {\n  workinghours mon,\n    tue 9:00 - 12:00\n}'],
		['leaveallowances', 'resource r "R" {\n  leaveallowances annual 2024-01-01 20d\n}'],
	])('still continues %s on the next line', (_what, text) => {
		expect(errorNodes(tjpGlobalParser.parse(text), text)).toEqual([]);
	});

	it('wraps recovery in a MacroCallStatement with no macro token', () => {
		// After `effort 5d`, Lezer recovers from `3h` by inserting a statement head; the node it
		// builds is a MacroCallStatement whose head is an error node, not a macro call.
		const text = 'task a "A" {\n  effort 5d 3h\n}';
		const tree = tjpGlobalParser.parse(text);
		const stmt = tree.topNode
			.getChild('TaskStatement')
			?.getChild('Body')
			?.getChild('MacroCallStatement');
		expect(stmt).toBeTruthy();
		expect(stmt && isRecoveryStatement(stmt)).toBe(true);
		const real = tjpGlobalParser.parse('task a "A" { ${m} }');
		const call = real.topNode
			.getChild('TaskStatement')
			?.getChild('Body')
			?.getChild('MacroCallStatement');
		expect(call && isRecoveryStatement(call)).toBe(false);
	});

	it('keeps an unterminated construct in one error node to the end', () => {
		const text = 'task a "A" {\n  note "x }\n}\n';
		const tree = tjpGlobalParser.parse(text);
		const scan: [number, number][] = [];
		tree.iterate({
			enter(n) {
				if (n.name === 'ScanError') scan.push([n.from, n.to]);
			},
		});
		expect(scan).toEqual([[text.indexOf('"x'), text.length]]);
	});
});

describe('node vocabulary', () => {
	it('lists the typed and opaque statements', () => {
		const statements = tjpGlobalParser.nodeSet.types
			.map((t) => t.name)
			.filter((n) => n.endsWith('Statement'));
		expect(new Set(statements)).toEqual(new Set([...TYPED_STATEMENTS, ...OPAQUE_STATEMENTS]));
		expect(TYPED_STATEMENTS.size).toBe(40);
		for (const n of MACRO_TOKENS) expect(statements).not.toContain(n);
	});

	it('maps every typed keyword id to its statement and to a table entry', () => {
		const ids = new Set(KEYWORDS.map((k) => k.keyword));
		for (const id of TYPED_KEYWORD_IDS) {
			expect(ids.has(id), id).toBe(true);
			expect(TYPED_STATEMENTS.has(typedStatementOf(id) ?? ''), id).toBe(true);
		}
		expect(typedStatementOf('effort')).toBe('EffortStatement');
		expect(typedStatementOf('note.task')).toBe('NoteStatement');
		expect(typedStatementOf('booking.task')).toBeNull();
	});
});
