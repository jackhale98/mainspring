// SPDX-License-Identifier: GPL-2.0-or-later
/** Markdown report of the responsiveness runs (test-results/responsiveness-report.md). */
import type { LongTaskRecord } from './responsiveness-monitor';

export interface WindowReport {
	status: string;
	ok: boolean;
	tasks: number;
	bookings: number;
	scheduleMs: number;
	totalMs: number;
	windowMs: number;
	/** performance.now() values: window start, worker ready, window end. */
	start: number;
	readyAt: number;
	end: number;
	longTasks: LongTaskRecord[];
	/** Long tasks that began before the worker was ready (cold window only), and the rest. */
	bootLongTasks: LongTaskRecord[];
	scheduleLongTasks: LongTaskRecord[];
	maxFrameGapMs: number;
	maxInputHandlerMs: number;
	maxInputFrameMs: number;
	inputCount: number;
}

export interface RunReport {
	label: string;
	/** CPU slowdown factor; 1 is none. */
	throttle: number;
	cold: WindowReport;
	warm: WindowReport;
	/** Chromium traces of the cold and warm windows; null when the run was not traced. */
	traceCold: TraceStats | null;
	traceWarm: TraceStats | null;
}

export interface TraceStats {
	/** Longest main-thread task, wall-clock ms, and longest thread CPU time of any task. */
	maxMs: number;
	maxCpuMs: number;
	taskCount: number;
	file: string;
}

const ms = (n: number): string => n.toFixed(1);

function row(r: RunReport, name: 'cold' | 'warm'): string {
	const w = r[name];
	const t = name === 'cold' ? r.traceCold : r.traceWarm;
	const trace = t ? `${ms(t.maxMs)} (cpu ${ms(t.maxCpuMs)})` : '-';
	const long =
		name === 'cold'
			? `${w.longTasks.length} (boot ${w.bootLongTasks.length}, after ready ${w.scheduleLongTasks.length})`
			: String(w.longTasks.length);
	const input = `${ms(w.maxInputHandlerMs)} / ${ms(w.maxInputFrameMs)}`;
	return `| ${r.label} | ${name} | ${long} | ${trace} | ${ms(w.maxFrameGapMs)} | ${input} | ${w.inputCount} | ${w.tasks} | ${ms(w.scheduleMs)} | ${ms(w.windowMs)} |`;
}

export function renderReport(runs: readonly RunReport[], limitMs: number): string {
	const lines = [
		'# Engine responsiveness (gate criterion 2)',
		'',
		`Plan syn-20-scale-1000, Chromium. Limit: no task over ${limitMs} ms. Throttled runs are reported, not asserted.`,
		'Trace max task: wall-clock ms of the longest CrRendererMain task, then its longest thread CPU time.',
		'',
		'| Run | Window | Long tasks | Trace max task ms | Max rAF gap ms | Max input latency ms (handler / next frame) | Keys | Tasks | Worker scheduleMs | Window ms |',
		'| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
	];
	for (const r of runs) lines.push(row(r, 'cold'), row(r, 'warm'));
	const traced = runs.find((r) => r.traceWarm);
	if (traced?.traceCold && traced.traceWarm) {
		lines.push('', `Traces: ${traced.traceCold.file}, ${traced.traceWarm.file}`);
	}
	const slow = runs.flatMap((r) =>
		[...r.cold.longTasks, ...r.warm.longTasks].map(
			(t) => `${r.label}: ${ms(t.duration)} ms at ${ms(t.start)}`,
		),
	);
	if (slow.length > 0) lines.push('', '## Long tasks', '', ...slow.map((s) => `- ${s}`));
	return `${lines.join('\n')}\n`;
}
