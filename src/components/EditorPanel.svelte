<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The editor panel (phase-1.md 8.2): a toolbar with the file switcher, Format and Docs, and one
	CodeMirror view. The workspace holds an EditorState per file (text, undo history, cursor);
	switching files gives the view another of them, so each file keeps its own state. Typing,
	format and every other transaction are committed to the workspace through `workspaceDispatch`;
	the view never owns the text. The panel is created again for each workspace (`{#key}` in the
	parent), so a new sample gets a fresh view. This component is imported with the editor packages,
	when a mode first shows the editor (App.svelte); `ensureEditor` loads the rest and gives the
	workspace its editor support before the view is made.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { EditorController } from '../lib/state/editor-controller';
	import Icon from './Icon.svelte';
	import UndoRedo from './app/UndoRedo.svelte';
	import type { AppState } from '../lib/state/app.svelte';
	import type { LayoutKind } from '../lib/state/layout.svelte';
	import { editorStrings, strings } from '../lib/strings';
	import type { Workspace } from '../lib/workspace/workspace';
	import FileSwitcher from './FileSwitcher.svelte';

	interface Props {
		app: AppState;
		ws: Workspace;
		layout: LayoutKind;
	}
	let { app, ws, layout }: Props = $props();

	let host: HTMLDivElement | undefined = $state();
	/** Set once the view exists; the effects below start then. */
	let ctl = $state.raw<EditorController | null>(null);

	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const keys = (c: { mac: string; other: string }): string => (mac ? c.mac : c.other);
	const C = editorStrings.commands;

	onMount(() => {
		let made: EditorController | null = null;
		let gone = false;
		// The workspace gets its editor support first: the states then have history and the TJP
		// extensions, and the view is made on them.
		void app.ensureEditor().then(() => {
			if (gone || !host) return;
			const c = new EditorController(
				ws,
				host,
				untrack(() => app.activeFile),
				(h) => (app.editorHistory = h),
			);
			made = c;
			app.editor = c.view;
			app.editorController = c;
			ctl = c;
		});
		return () => {
			gone = true;
			if (made) {
				if (app.editor === made.view) app.editor = null;
				if (app.editorController === made) app.editorController = null;
				app.editorHistory = { canUndo: false, canRedo: false };
				made.destroy();
			}
			ctl = null;
		};
	});

	$effect(() => {
		const path = app.activeFile;
		const c = ctl;
		if (c) untrack(() => c.show(path));
	});

	// The runner's diagnostics go to the view on the lint layer's two channels. The engine's are
	// pushed when a result arrives (the layer maps them through later edits and marks them stale);
	// the document layer's whenever its checks change. The view keeps only this file's.
	$effect(() => {
		void app.engineRevision;
		const path = app.activeFile;
		const c = ctl;
		if (c) {
			untrack(() => {
				c.show(path);
				c.setEngine(app.engineDiagnostics);
			});
		}
	});

	$effect(() => {
		const list = app.localDiagnostics;
		const path = app.activeFile;
		const c = ctl;
		if (c) {
			untrack(() => {
				c.show(path);
				c.setLocal(list);
			});
		}
	});

	$effect(() => {
		const r = app.reveal;
		const c = ctl;
		if (r && c) untrack(() => c.reveal(r.file, r.from, r.to, r.focus));
	});
</script>

<div class="editor">
	<div class="toolbar">
		<FileSwitcher {app} {layout} />
		<p class="note" role="status">{app.note ?? ''}</p>
		<div class="actions">
			{#if layout === 'phone'}<UndoRedo {app} />{/if}
			<button
				type="button"
				onclick={() => ctl?.format()}
				title="{C.format.label} ({keys(C.format)})"
				aria-keyshortcuts={keys(C.format).replaceAll(' ', '+')}
			>
				<Icon name="format" size={15} />{strings.editor.format}
			</button>
			<button
				type="button"
				onclick={() => app.openDocs()}
				title="{C.showDocs.label} ({keys(C.showDocs)})"
			>
				<Icon name="book" size={15} />{strings.editor.docs}
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
		min-block-size: 52px;
		padding-inline: var(--space-2) var(--gutter);
		border-block-end: 1px solid var(--color-border);
		background: var(--color-surface);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.actions button:not([data-testid]) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-block-size: 32px;
		padding-inline: 12px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
	}
	.actions button:not([data-testid]):hover {
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
		overscroll-behavior: none;
	}
	@media (pointer: coarse) {
		.actions button:not([data-testid]) {
			min-block-size: var(--size-tap);
		}
	}
</style>
