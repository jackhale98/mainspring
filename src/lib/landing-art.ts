// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Geometry for the landing page's drawings (ADR-0011): the Gantt in the product mocks, the
 * power-reserve gauge, the guilloché rosette and a small syntax highlighter for the plan text.
 * Pure functions, so the Astro components only place what these return. Nothing here schedules
 * anything: the sample plan's bars are positioned by hand in landing-sample.ts, the way the real
 * scheduler would lay them out.
 */
import type { SampleTask } from './landing-sample';

const round = (n: number): number => Math.round(n * 10) / 10;

// ---- Plan text -------------------------------------------------------------------------------

export type TokenKind = 'kw' | 'str' | 'num' | 'id' | 'cmt' | 'txt';
export interface Token {
	kind: TokenKind;
	text: string;
}

const KEYWORDS = new Set([
	'project',
	'resource',
	'task',
	'depends',
	'effort',
	'allocate',
	'milestone',
]);
/** After one of these, the next words are ids (until something other than a comma or space). */
const TAKES_IDS = new Set(['project', 'resource', 'task', 'allocate', 'depends']);
const PIECE =
	/(#.*$)|("[^"]*")|(\d{4}-\d{2}-\d{2}|\+?\d+(?:\.\d+)?[wdhm]?(?![\w]))|(!*[A-Za-z_][\w.]*)|(\s+)|(.)/g;

/** Splits one line of TaskJuggler text into coloured pieces. Joining the pieces gives the line. */
export function tokenize(line: string): Token[] {
	const out: Token[] = [];
	let expectId = false;
	for (const m of line.matchAll(PIECE)) {
		const [text, cmt, str, num, word, space] = m;
		if (cmt) out.push({ kind: 'cmt', text });
		else if (str) {
			out.push({ kind: 'str', text });
			expectId = false;
		} else if (num) {
			out.push({ kind: 'num', text });
			expectId = false;
		} else if (word) {
			if (KEYWORDS.has(word)) {
				out.push({ kind: 'kw', text });
				expectId = TAKES_IDS.has(word);
			} else if (word.startsWith('!') || expectId) out.push({ kind: 'id', text });
			else out.push({ kind: 'txt', text });
		} else if (space) out.push({ kind: 'txt', text });
		else {
			out.push({ kind: 'txt', text });
			if (text !== ',') expectId = false;
		}
	}
	return out;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/** The pieces of one line as HTML, with no whitespace added between them. */
export function tokensToHtml(tokens: readonly Token[]): string {
	return tokens
		.map(
			(t) => `<span class="${t.kind}">${t.text.replace(/[&<>]/g, (c) => ESCAPES[c] ?? c)}</span>`,
		)
		.join('');
}

// ---- Gantt -----------------------------------------------------------------------------------

export interface GanttOptions {
	/** Width of the task-name column, in drawing units. */
	nameCol: number;
	/** Width of one calendar day. */
	dayW: number;
	/** Days drawn; bars that run past the last one are cut off, as on a phone. */
	days: number;
	rowH: number;
	headerH: number;
	barH: number;
	/** Calendar day of the today line (a fraction places it inside a day). */
	today: number;
}

export interface GanttRow {
	task: SampleTask;
	y: number;
	cy: number;
	/** Bar left edge and width; for a milestone, the diamond's centre and `w` is 0. */
	x: number;
	w: number;
	/** Where the progress fill ends. */
	progressX: number;
	/** Where the first avatar starts. */
	avatarX: number;
}

export interface GanttLink {
	d: string;
	arrow: string;
	critical: boolean;
}

export interface GanttLayout {
	options: GanttOptions;
	width: number;
	height: number;
	rows: GanttRow[];
	links: GanttLink[];
	weekends: { x: number; w: number }[];
	/** A tick at the start of every week. */
	weeks: { x: number; index: number }[];
	todayX: number;
}

/** Days 5 and 6 of each week (Saturday and Sunday) are not working days. */
const isWeekend = (day: number): boolean => day % 7 >= 5;

export function ganttLayout(plan: readonly SampleTask[], o: GanttOptions): GanttLayout {
	const x0 = o.nameCol;
	const dayX = (d: number): number => x0 + d * o.dayW;
	const rows: GanttRow[] = plan.map((task, i) => {
		const y = o.headerH + i * o.rowH;
		const cy = y + o.rowH / 2;
		const milestone = task.milestone === true;
		const x = dayX(task.start);
		const w = milestone ? 0 : (task.end - task.start) * o.dayW;
		const right = milestone ? x + 8 : x + w;
		return {
			task,
			y,
			cy,
			x: round(x),
			w: round(w),
			progressX: round(x + w * task.progress),
			avatarX: round(right + 12),
		};
	});

	const half = 7; // half of the milestone diamond
	const r = 4; // elbow radius
	const links: GanttLink[] = [];
	for (const succ of rows) {
		for (const id of succ.task.after) {
			const pred = rows.find((row) => row.task.id === id);
			if (!pred) continue;
			const critical = pred.task.critical && succ.task.critical;
			const px = pred.task.milestone ? pred.x + half : pred.x + pred.w;
			const py = pred.cy;
			const sy = succ.cy;
			if (succ.task.milestone && succ.x <= px + 2) {
				// The milestone sits right under the end of its predecessor: drop straight down.
				const x = round(px - 6);
				links.push({
					d: `M${x} ${round(py + o.barH / 2)}V${round(sy - half - 2)}`,
					arrow: `M${round(x - 3)} ${round(sy - half - 6)}L${x} ${round(sy - half - 2)}L${round(x + 3)} ${round(sy - half - 6)}`,
					critical,
				});
				continue;
			}
			const sx = succ.x;
			const mx = px + 8;
			links.push({
				d: `M${round(px)} ${round(py)}H${round(mx - r)}Q${round(mx)} ${round(py)} ${round(mx)} ${round(py + r)}V${round(sy - r)}Q${round(mx)} ${round(sy)} ${round(mx + r)} ${round(sy)}H${round(sx - 2)}`,
				arrow: `M${round(sx - 6)} ${round(sy - 3)}L${round(sx - 2)} ${round(sy)}L${round(sx - 6)} ${round(sy + 3)}`,
				critical,
			});
		}
	}

	const weekends: GanttLayout['weekends'] = [];
	for (let d = 0; d < o.days; d++) {
		if (isWeekend(d)) weekends.push({ x: round(dayX(d)), w: o.dayW });
	}
	const weeks: GanttLayout['weeks'] = [];
	for (let d = 0, i = 0; d < o.days; d += 7, i++) weeks.push({ x: round(dayX(d)), index: i });

	return {
		options: o,
		width: x0 + o.days * o.dayW,
		height: o.headerH + rows.length * o.rowH + 6,
		rows,
		links,
		weekends,
		weeks,
		todayX: round(dayX(o.today)),
	};
}

// ---- Power-reserve gauge ---------------------------------------------------------------------

export interface Gauge {
	track: string;
	arc: string;
	ticks: string[];
	needle: { x2: number; y2: number };
	hub: { cx: number; cy: number };
}

const G = { cx: 48, cy: 54, r: 36, tickIn: 42, tickOut: 46, needle: 29 };

function onArc(percent: number, radius: number): { x: number; y: number } {
	const theta = Math.PI * (1 - Math.min(100, Math.max(0, percent)) / 100);
	return { x: round(G.cx + radius * Math.cos(theta)), y: round(G.cy - radius * Math.sin(theta)) };
}

/** A half-circle gauge in a 96 by 62 box: a brass tick arc, a track and the needle at `percent`. */
export function gauge(percent: number): Gauge {
	const start = onArc(0, G.r);
	const end = onArc(100, G.r);
	const here = onArc(percent, G.r);
	const tip = onArc(percent, G.needle);
	const ticks: string[] = [];
	for (let p = 0; p <= 100; p += 10) {
		const a = onArc(p, G.tickIn);
		const b = onArc(p, G.tickOut);
		ticks.push(`M${a.x} ${a.y}L${b.x} ${b.y}`);
	}
	return {
		track: `M${start.x} ${start.y}A${G.r} ${G.r} 0 0 1 ${end.x} ${end.y}`,
		arc: percent <= 0 ? '' : `M${start.x} ${start.y}A${G.r} ${G.r} 0 0 1 ${here.x} ${here.y}`,
		ticks,
		needle: { x2: tip.x, y2: tip.y },
		hub: { cx: G.cx, cy: G.cy },
	};
}

// ---- Guilloché -------------------------------------------------------------------------------

/**
 * Rotations, in degrees, that spread `count` copies of one ellipse round a centre. An ellipse
 * looks the same after half a turn, so the copies cover 180 degrees. Drawn together they make
 * the rosette of an engine-turned dial.
 */
export function rosetteAngles(count: number): number[] {
	return Array.from({ length: count }, (_, i) => round((i * 180) / count));
}

/** Centres of `count` equal circles whose rims all pass through the middle of the rosette. */
export function flowerCentres(count: number, radius: number): { cx: number; cy: number }[] {
	return Array.from({ length: count }, (_, i) => {
		const a = (2 * Math.PI * i) / count;
		return { cx: round(radius * Math.cos(a)), cy: round(radius * Math.sin(a)) };
	});
}

/** The avatar colour (tokens.css, --color-gantt-avatar-N) of each person in the sample plan. */
export const AVATAR: Readonly<Record<string, number>> = { A: 3, B: 4, C: 5 };
