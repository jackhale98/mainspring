<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The editor panel (phase-1.md 8.2): a toolbar with the file switcher, Format and Docs, and one
	CodeMirror view. The workspace holds an EditorState per file (text, undo history, cursor);
	switching files gives the view another of them, so each file keeps its own state. Typing,
	format and every other transaction are committed to the workspace through `workspaceDispatch`;
	the view never owns the text. The panel is created again for each workspace (`{#key}` in the
	parent), so a new sample gets a fresh view.
-->
<script lang="ts">
	import { EditorView } from '@codemirror/view';
	import { onMount, untrack } from 'svelte';
	import type { AppState } from '../lib/state/app.svelte';
	import type { LayoutKind } from '../lib/state/layout.svelte';
	import { editorStrings, strings } from '../lib/strings';
	import {
		formatCommand,
		setEngineDiagnostics,
		setLocalDiagnostics,
		workspaceDispatch,
	} from '../lib/tjp/cm';
	import type { Workspace } from '../lib/workspace/workspace';
	import FileSwitcher from './FileSwitcher.svelte';

	interface Props {
		app: AppState;
		ws: Workspace;
		layout: LayoutKind;
	}
	let { app, ws, layout }: Props = $props();

	let host: HTMLDivElement | undefined = $state();
	let view: EditorView | null = null;
	/** The file whose state the view shows. */
	let shown = untrack(() => app.activeFile);
	const scrolls = new Map<string, number>();

	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const keys = (c: { mac: string; other: string }): string => (mac ? c.mac : c.other);
	const C = editorStrings.commands;

	/** Gives the view another file's state, remembering where this file was scrolled to. */
	function switchTo(path: string): void {
		if (!view || path === shown) return;
		scrolls.set(shown, view.scrollDOM.scrollTop);
		shown = path;
		view.setState(ws.state(path));
		const top = scrolls.get(path) ?? 0;
		requestAnimationFrame(() => {
			if (view) view.scrollDOM.scrollTop = top;
		});
	}

	onMount(() => {
		if (!host) return;
		const v = new EditorView({
			parent: host,
			state: ws.state(shown),
			dispatchTransactions: workspaceDispatch(ws, () => shown),
		});
		view = v;
		app.editor = v;
		// Edits made without the view (the edit API, Phase 2) leave it behind the workspace.
		const off = ws.subscribe(() =>
			queueMicrotask(() => {
				if (view && view.state !== ws.state(shown)) view.setState(ws.state(shown));
			}),
		);
		return () => {
			off();
			if (app.editor === v) app.editor = null;
			v.destroy();
			view = null;
		};
	});

	$effect(() => {
		const path = app.activeFile;
		untrack(() => switchTo(path));
	});

	// The runner's diagnostics go to the view on the lint layer's two channels: the engine's own,
	// and the document layer's (syntax, value, attribute). The view keeps only this file's.
	$effect(() => {
		const list = app.diagnostics;
		const path = app.activeFile;
		untrack(() => {
			if (!view) return;
			switchTo(path);
			setEngineDiagnostics(
				view,
				list.filter((d) => d.source === 'engine'),
			);
			setLocalDiagnostics(
				view,
				list.filter((d) => d.source !== 'engine'),
			);
		});
	});

	$effect(() => {
		const r = app.reveal;
		if (!r) return;
		untrack(() => {
			if (!view) return;
			switchTo(r.file);
			const length = view.state.doc.length;
			const from = Math.min(Math.max(0, r.from), length);
			const to = Math.min(Math.max(from, r.to), length);
			view.dispatch({
				selection: { anchor: from, head: to },
				effects: EditorView.scrollIntoView(from, { y: 'center' }),
				userEvent: 'select',
			});
			view.focus();
		});
	});
</script>

<div class="editor">
	<div class="toolbar">
		<FileSwitcher {app} {layout} />
		<p class="note" role="status">{app.note ?? ''}</p>
		<div class="actions">
			<button
				type="button"
				onclick={() => view && formatCommand(view)}
				title="{C.format.label} ({keys(C.format)})"
				aria-keyshortcuts={keys(C.format).replaceAll(' ', '+')}
			>
				{strings.editor.format}
			</button>
			<button
				type="button"
				onclick={() => app.openDocs()}
				title="{C.showDocs.label} ({keys(C.showDocs)})"
			>
				{strings.editor.docs}
			</button>
		</div>
	</div>
	<div
		class="host"
		bind:this={host}
		id="panel-editor"
		role={layout === 'phone' ? undefined : 'tabpanel'}
		aria-labelledby={layout === 'phone'
			? undefined
			: `file-tab-${app.files.indexOf(app.activeFile)}`}
	></div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		min-block-size: 0;
		block-size: 100%;
		background: var(--color-surface);
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding-inline: var(--space-2) var(--gutter);
		border-block-end: 1px solid var(--color-border);
		background: var(--color-surface-sunken);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.actions button {
		min-block-size: 2rem;
		padding-inline: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.actions button:hover {
		background: var(--color-row-hover);
	}
	.note {
		margin: 0 0 0 auto;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.host {
		flex: 1 1 0;
		min-block-size: 0;
		overflow: hidden;
	}
	.host :global(.cm-editor) {
		block-size: 100%;
	}
	.host :global(.cm-scroller) {
		overflow: auto;
	}
	@media (pointer: coarse) {
		.actions button {
			min-block-size: var(--size-tap);
		}
	}
</style>
