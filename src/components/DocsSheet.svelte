<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The documentation for the keyword or id at the editor's cursor, in a bottom sheet. Hover does
	not exist on touch, so every width has the Docs button; this is what it opens. The content is
	the same `docsAtCursor` the keyboard command shows as a tooltip.
-->
<script lang="ts">
	import type { EditorSelection } from '@codemirror/state';
	import { untrack } from 'svelte';
	import type { AppState } from '../lib/state/app.svelte';
	import { restoreEditor } from '../lib/state/docs-return';
	import { editorStrings, strings } from '../lib/strings';
	import Sheet from './Sheet.svelte';

	let { app }: { app: AppState } = $props();
	const doc = $derived(app.docsContent);

	// A finger's Docs button does not take the focus: the editor still has it (and the keyboard) when
	// the sheet opens, and has it again, at the same cursor, when the sheet has gone. Read before the
	// sheet (a child) opens, which is when the keyboard goes.
	let back: EditorSelection | null = null;
	$effect.pre(() => {
		if (app.docsOpen)
			back = untrack(() => (app.editor?.hasFocus ? app.editor.state.selection : null));
	});
</script>

<Sheet
	open={app.docsOpen}
	side="bottom"
	title={strings.editor.docsTitle}
	onclose={() => (app.docsOpen = false)}
	onleft={() => {
		restoreEditor(app.editor, back);
		back = null;
	}}
>
	{#if doc}
		<h3 class="heading">{doc.title}</h3>
		{#if doc.code}<pre class="code"><code>{doc.code}</code></pre>{/if}
		{#each doc.notes as note (note)}<p class="note">{note}</p>{/each}
		{#if doc.body}<p class="body">{doc.body}</p>{/if}
		{#if doc.seeAlso.length > 0}
			<p class="see">
				{editorStrings.hover.seeAlso(doc.seeAlso)}
			</p>
		{/if}
	{/if}
</Sheet>

<style>
	.heading {
		margin: 0 0 var(--space-2);
		font-size: var(--text-md);
	}
	.code {
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-3);
		overflow-x: auto;
		border-radius: var(--radius-sm);
		background: var(--color-surface-sunken);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.body,
	.note,
	.see {
		margin: 0 0 var(--space-3);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.note,
	.see {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
