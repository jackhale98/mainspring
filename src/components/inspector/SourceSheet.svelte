<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The show-source sheet (phase-2.md 9.1): a task's declaration block, read-only and highlighted
	(lib/inspector/source.ts), so Visual mode and the phone can show what the plan says without the
	editor. "Open in text" opens the block in the editor. The colours are the editor's own syntax
	tokens, so the two look alike in light and dark.
-->
<script lang="ts">
	import { sourceBlock } from '../../lib/inspector/source';
	import { inspectorStrings as S } from '../../lib/strings';
	import Sheet from '../Sheet.svelte';
	import { getInspector } from './context';

	const { app, showInText } = getInspector();

	const id = $derived(app.inspector.source);
	const node = $derived(id === null ? null : (app.index?.tasks.get(id) ?? null));
	const block = $derived.by(() => {
		const ws = app.workspace;
		return ws && node ? sourceBlock(ws, app.run?.indexVersion, node.decl.block) : null;
	});
	const name = $derived(node ? (node.name ?? node.localId) : '');

	function openInText(): void {
		const at = block?.at;
		app.inspector.source = null;
		if (at) showInText(at);
	}
</script>

<Sheet
	open={id !== null}
	side="bottom"
	title={S.source.title(name)}
	onclose={() => (app.inspector.source = null)}
>
	{#if block}
		<p class="file">{S.source.file(block.at.file)}</p>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<pre class="code" role="region" tabindex="0" aria-label={S.source.region}><code
				>{#each block.segments as seg, n (n)}<span class={seg.cls}>{seg.text}</span>{/each}</code
			></pre>
		{#if block.cut}<p class="cut">{S.source.cut(block.lines)}</p>{/if}
		<button type="button" class="button" onclick={openInText}>{S.source.openInText}</button>
	{:else}
		<p class="file">{S.source.none}</p>
	{/if}
</Sheet>

<style>
	.file {
		margin: 0 0 var(--space-2);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.cut {
		margin: 0 0 var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.code {
		margin: 0 0 var(--space-3);
		padding: var(--space-3);
		overflow-x: auto;
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: var(--leading);
		tab-size: 2;
	}
	/* The editor's syntax colours (theme.ts reads the same tokens). */
	.code:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.code :global(.tok-keyword) {
		color: var(--color-syntax-keyword);
		font-weight: 600;
	}
	.code :global(.tok-definition) {
		color: var(--color-syntax-definition);
		font-weight: 600;
	}
	.code :global(.tok-reference) {
		color: var(--color-syntax-reference);
	}
	.code :global(.tok-string) {
		color: var(--color-syntax-string);
	}
	.code :global(.tok-literal) {
		color: var(--color-syntax-literal);
	}
	.code :global(.tok-comment) {
		color: var(--color-syntax-comment);
		font-style: italic;
	}
	.code :global(.tok-macro) {
		color: var(--color-syntax-macro);
	}
	.code :global(.tok-punct) {
		color: var(--color-text-muted);
	}
	.code :global(.tok-invalid) {
		color: var(--color-syntax-invalid);
		text-decoration: underline wavy;
	}
	.button {
		min-block-size: var(--size-tap);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	.button:hover {
		background: var(--color-row-hover);
	}
	.button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
