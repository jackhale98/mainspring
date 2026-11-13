<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Edit toasts (phase-2.md 6.8, 9.4, 11.2; ADR-0009 "the toast sits in a corner"): one per visual
	edit, newest at the bottom, in a polite live region that exists before any toast, so each one is
	announced. A toast names the edit ("Effort of Research: 3d to 4d") and says "Rescheduling…" until
	the engine's result includes it. Undo works only while that edit is the newest undo step
	(ADR-0008); it then does exactly what Mod-Z does. "No longer schedules", failures and refusals
	stay until dismissed; they offer Show, which puts the cursor on the place in the text.

	Desktop and tablet: the bottom-right corner, above the status strip. Phone: centred above the
	floating tab bar. The list reads `app.edits`; it draws nothing while no plan is open.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import type { Toast } from '../../lib/state/edits.svelte';
	import { toastStrings as S } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	let { app, phone = false }: { app: AppState; phone?: boolean } = $props();

	const edits = $derived(app.edits);
	const list = $derived(edits?.toasts ?? []);
	const problem = (t: Toast): boolean =>
		t.status === 'not-scheduled' || t.status === 'failed' || t.status === 'refused';
</script>

<section class="toasts" class:phone aria-label={S.region}>
	<div role="status" aria-live="polite" aria-relevant="additions text" class="stack">
		{#each list as t (t.id)}
			<div class="toast" data-testid="toast" data-status={t.status} class:problem={problem(t)}>
				<div class="body">
					<p class="text">{t.text}</p>
					{#if t.detail}<p class="detail">{t.detail}</p>{/if}
					{#if t.warning}<p class="warning">{t.warning}</p>{/if}
				</div>
				<div class="actions">
					{#if t.entry !== null}
						<button
							type="button"
							class="action"
							disabled={!t.canUndo}
							title={t.canUndo ? S.undoWhat(t.detail && problem(t) ? t.detail : t.text) : undefined}
							onclick={() => edits?.undoToast(t.id)}>{S.undo}</button
						>
					{/if}
					{#if t.show}
						<button type="button" class="action" onclick={() => edits?.showToast(t.id)}>
							{t.status === 'refused' ? S.showInText : S.show}
						</button>
					{/if}
					<button
						type="button"
						class="dismiss"
						aria-label={S.dismiss}
						title={S.dismiss}
						onclick={() => edits?.dismissToast(t.id)}
					>
						<Icon name="close" size={15} />
					</button>
				</div>
			</div>
		{/each}
	</div>
</section>

<style>
	.toasts {
		position: fixed;
		inset-inline-end: max(calc(var(--gap-panel) * 2), env(safe-area-inset-right));
		inset-block-end: calc(var(--space-8) + 30px + env(safe-area-inset-bottom));
		z-index: 30;
		inline-size: min(26rem, calc(100vw - 2 * var(--gutter)));
		pointer-events: none;
	}
	/* Phones: centred, above the floating tab bar (its height, margins and the safe area). */
	.toasts.phone {
		inset-inline: 10px;
		inline-size: auto;
		inset-block-end: calc(var(--size-tabbar) + 26px + env(safe-area-inset-bottom));
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.toast {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 10px 8px 10px 14px;
		border-radius: 14px;
		background: var(--color-toast-bg);
		color: var(--color-toast-ink);
		box-shadow: var(--shadow-raised);
		font-size: var(--text-sm);
		pointer-events: auto;
		animation: rise var(--motion-base) ease-out;
	}
	.toast.problem {
		border-inline-start: 4px solid var(--color-ruby);
	}
	.body {
		flex: 1;
		min-inline-size: 0;
	}
	p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.text {
		font-weight: 600;
	}
	.detail,
	.warning {
		margin-block-start: 2px;
		font-size: var(--text-xs);
		opacity: 0.85;
	}
	.warning {
		opacity: 1;
		color: var(--color-toast-accent);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex: none;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-block-size: var(--size-tap);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.action {
		padding-inline: var(--space-3);
		color: var(--color-toast-accent);
		font-weight: 700;
	}
	.action:disabled {
		color: inherit;
		opacity: 0.55;
		cursor: default;
	}
	.dismiss {
		min-inline-size: var(--size-tap);
		opacity: 0.85;
	}
	button:hover:not(:disabled) {
		background: color-mix(in srgb, currentColor 12%, transparent);
	}
	button:focus-visible {
		outline: 3px solid var(--color-toast-accent);
		outline-offset: 1px;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation: none;
		}
	}
</style>
