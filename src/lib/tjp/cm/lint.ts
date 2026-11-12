// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Inline diagnostics (phase-1.md 6.6, 6.7, 8.2; §15.15). Diagnostics are pushed, not computed
 * here: the schedule runner (T14) pushes engine diagnostics after each run and the editor pushes
 * local ones (syntax, value and attribute checks) after each reparse, each on its own channel,
 * so one does not wipe the other. `setTjpDiagnostics(state, list, channel)` returns the
 * transaction spec; `setEngineDiagnostics(view, list)` dispatches it (spec 6.7).
 *
 * - Only this file's diagnostics are kept (`TjpDiagnostic.file` equal to the editor's path).
 * - Precision 'none' is never drawn: such a message has no usable place and is listed in the
 *   status strip only.
 * - The message is the diagnostic's own (local ones come from strings.ts, engine ones keep
 *   TaskJuggler's text) followed by its hint; the source label comes from strings.ts.
 * - The pushed lists are mapped through every change, as @codemirror/lint maps its marks. An
 *   engine diagnostic becomes stale at the first change after its run; stale ones are drawn
 *   dimmed (`cm-tjp-stale`) and say so. The redraw that dims them waits for a pause in typing.
 */
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import {
	StateEffect,
	StateField,
	type EditorState,
	type Extension,
	type StateEffect as Effect,
	type TransactionSpec,
} from '@codemirror/state';
import { keymap, ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { editorStrings as S } from '../../strings';
import { mapRange } from '../diagnostics-map';
import type { TjpDiagnostic } from '../diagnostics-types';
import { tjpEnv } from './env';

export type DiagnosticChannel = 'engine' | 'local';

interface Pushed {
	readonly engine: readonly TjpDiagnostic[];
	readonly local: readonly TjpDiagnostic[];
	/** Engine diagnostics turned stale since the marks were last drawn. */
	readonly dirty: boolean;
}

const EMPTY: Pushed = { engine: [], local: [], dirty: false };

const pushEffect = StateEffect.define<{
	channel: DiagnosticChannel;
	list: readonly TjpDiagnostic[];
}>();
const drawnEffect = StateEffect.define<null>();

/** The CSS class of stale diagnostics' marks. */
export const STALE_CLASS = 'cm-tjp-stale';

/** How long the stale redraw waits after the last change. */
export const STALE_REDRAW_MS = 300;

/** The diagnostics of this file that can be drawn, clamped to the document. */
function drawable(state: EditorState, list: readonly TjpDiagnostic[]): TjpDiagnostic[] {
	const path = state.facet(tjpEnv).path;
	const len = state.doc.length;
	const out: TjpDiagnostic[] = [];
	for (const d of list) {
		if (d.precision === 'none') continue;
		if (path !== '' && d.file !== path) continue;
		const from = Math.min(Math.max(0, Math.min(d.from, d.to)), len);
		const to = Math.min(Math.max(from, Math.max(d.from, d.to)), len);
		out.push(from === d.from && to === d.to ? d : { ...d, from, to });
	}
	return out;
}

export const tjpDiagnosticsField = StateField.define<Pushed>({
	create: () => EMPTY,
	update(value, tr) {
		let next = value;
		if (tr.docChanged && (next.engine.length > 0 || next.local.length > 0)) {
			const map = (d: TjpDiagnostic): TjpDiagnostic => {
				const r = mapRange(d.from, d.to, tr.changes);
				return r.from === d.from && r.to === d.to ? d : { ...d, ...r };
			};
			const turned = next.engine.some((d) => !d.stale);
			next = {
				engine: next.engine.map((d) => ({ ...map(d), stale: true })),
				local: next.local.map(map),
				dirty: next.dirty || turned,
			};
		}
		for (const e of tr.effects) {
			if (e.is(pushEffect)) {
				const list = drawable(tr.state, e.value.list);
				next =
					e.value.channel === 'engine'
						? { ...next, engine: list, dirty: false }
						: { ...next, local: list };
			} else if (e.is(drawnEffect)) {
				next = { ...next, dirty: false };
			}
		}
		return next;
	},
});

/** One TJP diagnostic as @codemirror/lint draws it. */
export function toLintDiagnostic(d: TjpDiagnostic): Diagnostic {
	const message = S.lint.message(d.message, d.hint);
	return {
		from: d.from,
		to: d.to,
		severity: d.severity,
		source: S.lint.source[d.source],
		message: d.stale ? S.lint.staleMessage(message) : message,
		...(d.stale ? { markClass: STALE_CLASS } : {}),
	};
}

/** What the lint layer draws for a field value: local first, then engine, by position. */
function lintDiagnostics(p: Pushed): Diagnostic[] {
	return [...p.local, ...p.engine]
		.sort((a, b) => a.from - b.from || a.to - b.to)
		.map(toLintDiagnostic);
}

/** The diagnostics the editor draws now (for tests and the status strip's "next" button). */
export function drawnDiagnostics(state: EditorState): Diagnostic[] {
	return lintDiagnostics(state.field(tjpDiagnosticsField, false) ?? EMPTY);
}

function effectsOf(spec: TransactionSpec): readonly Effect<unknown>[] {
	const e = spec.effects;
	if (!e) return [];
	return Array.isArray(e) ? (e as readonly Effect<unknown>[]) : [e as Effect<unknown>];
}

/**
 * The transaction spec that replaces one channel's diagnostics and redraws the marks. `list`
 * may hold other files' diagnostics; they are dropped.
 */
export function setTjpDiagnostics(
	state: EditorState,
	list: readonly TjpDiagnostic[],
	channel: DiagnosticChannel = 'engine',
): TransactionSpec {
	const before = state.field(tjpDiagnosticsField, false) ?? EMPTY;
	const kept = drawable(state, list);
	const after: Pushed =
		channel === 'engine' ? { ...before, engine: kept, dirty: false } : { ...before, local: kept };
	const push = pushEffect.of({ channel, list });
	const add =
		state.field(tjpDiagnosticsField, false) === undefined
			? [StateEffect.appendConfig.of(tjpDiagnosticsField)]
			: [];
	return { effects: [...add, push, ...effectsOf(setDiagnostics(state, lintDiagnostics(after)))] };
}

/** True when a push of `list` would draw exactly what the channel draws now. */
function unchanged(
	state: EditorState,
	list: readonly TjpDiagnostic[],
	channel: DiagnosticChannel,
): boolean {
	const before = state.field(tjpDiagnosticsField, false);
	if (!before || (channel === 'engine' && before.dirty)) return false;
	const old = before[channel];
	const kept = drawable(state, list);
	return (
		old.length === kept.length &&
		kept.every((d, i) => {
			const o = old[i];
			// `revision` differs on every result and changes nothing that is drawn.
			const keys = Object.keys(d) as Array<keyof TjpDiagnostic>;
			return o !== undefined && keys.every((k) => k === 'revision' || o[k] === d[k]);
		})
	);
}

/**
 * True while CodeMirror holds back an Android Enter or Backspace until the next animation frame
 * (`delayAndroidKey`). A transaction dispatched meanwhile drops that key, so the app's own
 * dispatches wait. `observer` is not public API; where it is missing this is false.
 */
export function androidKeyPending(view: EditorView): boolean {
	const o = (view as unknown as { observer?: { delayedAndroidKey?: unknown } }).observer;
	return !!o?.delayedAndroidKey;
}

const RETRY_MS = 16;
type Latest = Partial<Record<DiagnosticChannel, readonly TjpDiagnostic[]>>;
/** The newest list per channel waiting for a pending Android key to be handled. */
const waiting = new WeakMap<EditorView, Latest>();

/**
 * Pushes a channel's list unless it changes nothing, and not while an Android key is pending: the
 * newest list per channel then goes in a frame later, against the then-current state.
 */
function push(view: EditorView, list: readonly TjpDiagnostic[], channel: DiagnosticChannel): void {
	const queued = waiting.get(view);
	if (queued || androidKeyPending(view)) {
		const q = queued ?? {};
		q[channel] = list;
		if (queued) return;
		waiting.set(view, q);
		const retry = (): void => {
			if (!view.dom.isConnected) return void waiting.delete(view);
			if (androidKeyPending(view)) {
				setTimeout(retry, RETRY_MS);
				return;
			}
			const latest = waiting.get(view) ?? {};
			waiting.delete(view);
			for (const c of ['engine', 'local'] as const) {
				const l = latest[c];
				if (l) push(view, l, c);
			}
		};
		setTimeout(retry, RETRY_MS);
		return;
	}
	if (unchanged(view.state, list, channel)) return;
	view.dispatch(setTjpDiagnostics(view.state, list, channel));
}

/** Pushes the engine's diagnostics into a view (spec 6.7). */
export function setEngineDiagnostics(view: EditorView, d: readonly TjpDiagnostic[]): void {
	push(view, d, 'engine');
}

/** Pushes local diagnostics into a view. */
export function setLocalDiagnostics(view: EditorView, d: readonly TjpDiagnostic[]): void {
	push(view, d, 'local');
}

/** The spec that redraws the marks from the field, so stale ones are dimmed. */
export function redrawDiagnostics(state: EditorState): TransactionSpec {
	const p = state.field(tjpDiagnosticsField, false) ?? EMPTY;
	return {
		effects: [drawnEffect.of(null), ...effectsOf(setDiagnostics(state, lintDiagnostics(p)))],
	};
}

const staleRedraw = ViewPlugin.fromClass(
	class {
		private timer: ReturnType<typeof setTimeout> | null = null;

		constructor(private readonly view: EditorView) {}

		update(u: ViewUpdate): void {
			if (!u.docChanged || !(u.state.field(tjpDiagnosticsField, false)?.dirty ?? false)) return;
			this.arm(STALE_REDRAW_MS);
		}

		private arm(ms: number): void {
			if (this.timer !== null) clearTimeout(this.timer);
			this.timer = setTimeout(() => {
				this.timer = null;
				if (!this.view.state.field(tjpDiagnosticsField, false)?.dirty) return;
				// Not while an Android key is pending (see `androidKeyPending`).
				if (androidKeyPending(this.view)) this.arm(RETRY_MS);
				else this.view.dispatch(redrawDiagnostics(this.view.state));
			}, ms);
		}

		destroy(): void {
			if (this.timer !== null) clearTimeout(this.timer);
		}
	},
);

/**
 * Says the problem under the cursor when the cursor moves onto one (F8, the status strip's "next
 * problem" button, the arrow keys): the marks and the hover tooltip are visual only, so a screen
 * reader would otherwise hear the line and nothing about what is wrong with it. A polite live
 * region inside the editor, set once per problem and cleared when the cursor leaves it.
 */
const announceProblem = ViewPlugin.fromClass(
	class {
		private readonly region: HTMLElement;
		private spoken = '';

		constructor(view: EditorView) {
			this.region = view.dom.ownerDocument.createElement('div');
			this.region.className = 'cm-tjp-announce';
			this.region.setAttribute('role', 'status');
			this.region.setAttribute('aria-live', 'polite');
			view.dom.appendChild(this.region);
		}

		update(u: ViewUpdate): void {
			if (u.docChanged || !u.selectionSet) return;
			const head = u.state.selection.main.head;
			const hit = drawnDiagnostics(u.state).find((d) => d.from <= head && head <= d.to);
			const text = hit ? S.lint.announce(hit.severity, hit.message) : '';
			if (text === this.spoken) return;
			this.spoken = text;
			this.region.textContent = text;
		}

		destroy(): void {
			this.region.remove();
		}
	},
);

/**
 * The diagnostics field, the stale redraw, the lint keymap (F8 next diagnostic, Mod-Shift-m the
 * panel) and, unless `gutter: false`, the lint gutter.
 */
export function tjpLint(opts: { gutter?: boolean } = {}): Extension {
	return [
		tjpDiagnosticsField,
		staleRedraw,
		announceProblem,
		keymap.of(lintKeymap),
		opts.gutter === false ? [] : lintGutter(),
	];
}
