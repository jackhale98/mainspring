// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Term tables shared by the tokenizer (lexer.ts), the context tracker (context.ts) and parser.ts:
 * which scoped keyword ids have typed statements (phase-1.md 5.3), which terms are keyword heads,
 * and which nodes are statements.
 */
import * as T from './parser.terms.generated';

/** A typed statement: its head term and its statement node term. */
export interface TypedHead {
	readonly head: number;
	readonly statement: number;
}

const typed = (head: number, statement: number): TypedHead => ({ head, statement });

/** Scoped keyword id (as in KEYWORDS) to its typed statement. */
export const TYPED_KEYWORDS: ReadonlyMap<string, TypedHead> = new Map<string, TypedHead>([
	['project', typed(T.kwProject, T.ProjectStatement)],
	['include.properties', typed(T.kwInclude, T.IncludeStatement)],
	['include.project', typed(T.kwInclude, T.IncludeStatement)],
	['include.macro', typed(T.kwInclude, T.IncludeStatement)],
	['macro', typed(T.kwMacro, T.MacroStatement)],
	['flags', typed(T.kwFlags, T.FlagsStatement)],
	['flags.task', typed(T.kwFlags, T.FlagsStatement)],
	['flags.resource', typed(T.kwFlags, T.FlagsStatement)],
	['leaves', typed(T.kwLeaves, T.LeavesStatement)],
	['vacation', typed(T.kwVacation, T.VacationStatement)],
	['vacation.resource', typed(T.kwVacation, T.VacationStatement)],
	['timezone', typed(T.kwTimezone, T.TimezoneStatement)],
	['timeformat', typed(T.kwTimeformat, T.TimeformatStatement)],
	['currency', typed(T.kwCurrency, T.CurrencyStatement)],
	['now', typed(T.kwNow, T.NowStatement)],
	['dailyworkinghours', typed(T.kwDailyworkinghours, T.DailyworkinghoursStatement)],
	['weekstartsmonday', typed(T.kwWeekstartsmonday, T.WeekstartsmondayStatement)],
	['workinghours.project', typed(T.kwWorkinghours, T.WorkinghoursStatement)],
	['workinghours.resource', typed(T.kwWorkinghours, T.WorkinghoursStatement)],
	['task', typed(T.kwTask, T.TaskStatement)],
	['effort', typed(T.kwEffort, T.EffortStatement)],
	['length', typed(T.kwLength, T.LengthStatement)],
	['duration', typed(T.kwDuration, T.DurationStatement)],
	['start', typed(T.kwStart, T.StartStatement)],
	['end', typed(T.kwEnd, T.EndStatement)],
	['minstart', typed(T.kwMinstart, T.MinstartStatement)],
	['maxend', typed(T.kwMaxend, T.MaxendStatement)],
	['scheduling', typed(T.kwScheduling, T.SchedulingStatement)],
	['milestone', typed(T.kwMilestone, T.MilestoneStatement)],
	['priority', typed(T.kwPriority, T.PriorityStatement)],
	['complete', typed(T.kwComplete, T.CompleteStatement)],
	['note.task', typed(T.kwNote, T.NoteStatement)],
	['responsible', typed(T.kwResponsible, T.ResponsibleStatement)],
	['depends', typed(T.kwDepends, T.DependsStatement)],
	['precedes', typed(T.kwPrecedes, T.PrecedesStatement)],
	['gapduration', typed(T.kwGapduration, T.GapdurationStatement)],
	['gaplength', typed(T.kwGaplength, T.GaplengthStatement)],
	['onstart', typed(T.kwOnstart, T.OnstartStatement)],
	['onend', typed(T.kwOnend, T.OnendStatement)],
	['allocate', typed(T.kwAllocate, T.AllocateStatement)],
	['resource', typed(T.kwResource, T.ResourceStatement)],
	['efficiency', typed(T.kwEfficiency, T.EfficiencyStatement)],
	['rate', typed(T.kwRate, T.RateStatement)],
	['rate.resource', typed(T.kwRate, T.RateStatement)],
	['email', typed(T.kwEmail, T.EmailStatement)],
	['managers', typed(T.kwManagers, T.ManagersStatement)],
	['supplement', typed(T.kwSupplement, T.SupplementStatement)],
	['supplement.task', typed(T.kwSupplement, T.SupplementStatement)],
	['supplement.resource', typed(T.kwSupplement, T.SupplementStatement)],
]);

/** Every term that is a keyword at the head of a statement. */
export const HEAD_KEYWORD_TERMS: ReadonlySet<number> = new Set<number>([
	T.kw,
	T.kwArgs,
	T.kwBare,
	T.kwChoice,
	...[...TYPED_KEYWORDS.values()].map((t) => t.head),
]);

/** Statement node ids, typed and opaque. */
export const STATEMENT_TERMS: ReadonlySet<number> = new Set<number>([
	T.ProjectStatement,
	T.IncludeStatement,
	T.MacroStatement,
	T.FlagsStatement,
	T.LeavesStatement,
	T.VacationStatement,
	T.TimezoneStatement,
	T.TimeformatStatement,
	T.CurrencyStatement,
	T.NowStatement,
	T.DailyworkinghoursStatement,
	T.WeekstartsmondayStatement,
	T.WorkinghoursStatement,
	T.TaskStatement,
	T.EffortStatement,
	T.LengthStatement,
	T.DurationStatement,
	T.StartStatement,
	T.EndStatement,
	T.MinstartStatement,
	T.MaxendStatement,
	T.SchedulingStatement,
	T.MilestoneStatement,
	T.PriorityStatement,
	T.CompleteStatement,
	T.NoteStatement,
	T.ResponsibleStatement,
	T.DependsStatement,
	T.PrecedesStatement,
	T.GapdurationStatement,
	T.GaplengthStatement,
	T.OnstartStatement,
	T.OnendStatement,
	T.AllocateStatement,
	T.ResourceStatement,
	T.EfficiencyStatement,
	T.RateStatement,
	T.EmailStatement,
	T.ManagersStatement,
	T.SupplementStatement,
	T.ExtensionStatement,
	T.MacroCallStatement,
	T.OpaqueStatement,
]);
