<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Edit toasts (phase-2.md 6.8, 9.4, 11.2; ADR-0009 "the toast sits in a corner"): one per visual
	edit, newest at the bottom, in a polite live region that exists before any toast, so each one is
	announced. A toast names the edit ("Effort of Research: 3d to 4d") and says "Rescheduling…" until
	the engine's result includes it. Undo works only while that edit is the newest undo step
	(ADR-0008); it then does exactly what Mod-Z does. "No longer schedules", failures and refusals
	stay until dismissed; they offer Show, which puts the cursor on the place in the text.

	Desktop and tablet: the bottom-right corner, just above the footer (the status strip and its
	reload button stay visible): `bottom` is the footer's distance from the viewport's bottom,
	measured by App.svelte; the CSS offsets are the fallback before that.

	Phone (`phone`): no toast covers the chart. A successful edit says nothing on screen, because the
	status button already shows the reschedule; its text still goes into the live region, in a
	visually hidden line (`toast-quiet`), so a screen reader hears each outcome. Anything that needs
	reading (a refusal, "no longer schedules", a failure, a new error, the one-time constraint
	warning, a no-op or the app's own message) is one compact line in a strip under the top bar,
	in the page's flow, that takes no focus; it closes after the usual time unless it is sticky,
	and then keeps Show and Dismiss. Undo is the top bar's button there, not this strip's.
	The list reads `app.edits`; it draws nothing while no plan is open.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import type { Toast } from '../../lib/state/edits.svelte';
	import { toastStrings as S } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	interface Props {
		app: AppState;
		phone?: boolean;
		/** Pixels from the viewport's bottom to the footer's top; null before it is measured (not used on a phone). */
		bottom?: number | null;
	}
	let { app, phone = false, bottom = null }: Props = $props();

	const edits = $derived(app.edits);
	const list = $derived(edits?.toasts ?? []);
	const problem = (t: Toast): boolean =>
		t.status === 'not-scheduled' || t.status === 'failed' || t.status === 'refused';
	/** On a phone only what needs reading shows; a plain success is left to the status button. */
	const shown = (t: Toast): boolean =>
		(t.status !== 'pending' && t.status !== 'scheduled') || t.warning !== null;
	const line = (t: Toast): string =>
		problem(t) || t.status === 'new-error' || t.status === 'noop' ? t.text : (t.warning ?? t.text);
</script>

{#if phone}
	<section class="strip" aria-label={S.region}>
		<div role="status" aria-live="polite" aria-relevant="additions text" class="stack">
			{#each list as t (t.id)}
				{#if shown(t)}
					<div
						class="toast compact"
						data-testid="toast"
						data-status={t.status}
						class:problem={problem(t)}
					>
						<p class="text">{line(t)}</p>
						<div class="actions">
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
				{:else}
					<p class="sr-only" data-testid="toast-quiet" data-status={t.status}>
						{t.text}{t.detail ? ` ${t.detail}` : ''}
					</p>
				{/if}
			{/each}
		</div>
	</section>
{:else}
	<section
		class="toasts"
		aria-label={S.region}
		style:inset-block-end={bottom === null
			? undefined
			: `min(${bottom + 8}px, calc(100dvh - var(--toast-room)))`}
	>
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
								title={t.canUndo
									? S.undoWhat(t.detail && problem(t) ? t.detail : t.text)
									: undefined}
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
{/if}

<style>
	.toasts {
		position: fixed;
		inset-inline-end: max(calc(var(--gap-panel) * 2), env(safe-area-inset-right));
		inset-block-end: calc(var(--space-8) + 30px + env(safe-area-inset-bottom));
		z-index: 30;
		/* However high the bottom is asked for, a toast stays fully on screen. */
		--toast-room: 9rem;
		inline-size: min(26rem, calc(100vw - 2 * var(--gutter)));
		pointer-events: none;
	}
	/* Phones: a strip in the page's flow under the top bar; it is as tall as what it shows. */
	.strip {
		min-inline-size: 0;
	}
	.toast.compact {
		gap: var(--space-2);
		min-block-size: var(--size-tap);
		margin-block-end: 6px;
		padding: 0 4px 0 12px;
		border-radius: 12px;
		animation: none;
		box-shadow: var(--shadow-chip);
	}
	.toast.compact .text {
		flex: 1;
		min-inline-size: 0;
		padding-block: 6px;
		font-size: var(--text-sm);
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
