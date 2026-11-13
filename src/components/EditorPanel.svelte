<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The editor panel (phase-1.md 8.2): a toolbar with the file switcher, Format and Docs, and one
	CodeMirror view. The workspace holds an EditorState per file (text, cursor; undo is one history);
	switching files gives the view another of them, so each file keeps its own state. Typing,
	format and every other transaction are committed to the workspace through `workspaceDispatch`;
	the view never owns the text. The panel is created again for each workspace (`{#key}` in the
	parent), so a new sample gets a fresh view.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { EditorController } from '../lib/state/editor-controller';
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
		if (!host) return;
		const c = new EditorController(
			ws,
			host,
			untrack(() => app.activeFile),
		);
		app.editor = c.view;
		ctl = c;
		return () => {
			if (app.editor === c.view) app.editor = null;
			c.destroy();
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
		if (r && c) untrack(() => c.reveal(r.file, r.from, r.to, r.focus, r.select ?? true));
	});
</script>

<div class="editor">
	<div class="toolbar">
		<FileSwitcher {app} {layout} />
		<p class="note" role="status">{app.note ?? ''}</p>
		<div class="actions">
			<button
				type="button"
				onclick={() => ctl?.format()}
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
