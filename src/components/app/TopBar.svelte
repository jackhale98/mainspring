<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The top bar (phase-1.md 8.1; phase-2.md 9; ADR-0009), on the recessed canvas, not in a panel.
	Left to right: the outline button where the outline is a drawer, the brass mark and the serif
	wordmark, the plan chip, undo and redo, the centred mode switch, the engine pill and the theme
	toggle. It answers to its own width (a container query), not the window's: below 900 px the
	mode switch keeps icons and the active label, the engine pill shrinks to its dot and the
	wordmark goes. A phone has its own header: the plan's name as a serif title with the finish date under it (no
	brand mark: its room goes to the title), the sync status control, the project button, undo and redo (always visible; a press and hold on Undo
	opens the History sheet) and the status button (the plan's state as a shape; it opens the status,
	the History row, the Appearance choice that replaces the theme toggle here, and the engine
	details, and carries a pip when a new version is out); its tab bar replaces the mode switch.
	A desktop and a tablet have the Health button (the finding count; phase-3.md 9.1) before the
	engine pill: a phone's way to plan health is a row in the status button's card.
	The sync status control (T14; components/sync/SyncStatus.svelte) sits after the plan chip on every
	layout: icon and label where the bar is 1360 px or wider, the icon alone under that and on a phone;
	its panel is a popover on a desktop and a bottom sheet on a tablet and a phone.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import type { LayoutKind } from '../../lib/state/layout.svelte';
	import type { ThemeState } from '../../lib/state/theme.svelte';
	import type { ViewMode } from '../../lib/state/view-mode';
	import type { AppUpdates } from '../../lib/state/updates.svelte';
	import { strings } from '../../lib/strings';
	import HealthButton from '../health/HealthButton.svelte';
	import Icon from '../Icon.svelte';
	import EngineStatus from './EngineStatus.svelte';
	import LazyMount from './LazyMount.svelte';
	import Mark from './Mark.svelte';
	import ModeSwitch from './ModeSwitch.svelte';
	import PlanChip from './PlanChip.svelte';
	import StatusButton from './StatusButton.svelte';
	import SyncStatus from '../sync/SyncStatus.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import UndoRedo from './UndoRedo.svelte';

	interface Props {
		app: AppState;
		theme: ThemeState;
		layout: LayoutKind;
		mode: ViewMode;
		/** Whether the outline is a drawer here, so that the top bar has the button for it. */
		drawer: boolean;
		onmode: (mode: ViewMode) => void;
		/** Whether a newer build is deployed (ADR-0012); the phone's status button shows it. */
		updates?: AppUpdates | undefined;
	}
	let { app, theme, layout, mode, drawer, onmode, updates }: Props = $props();

	const phone = $derived(layout === 'phone');
	const finish = $derived(app.status?.finish ? strings.topBar.finish(app.status.finish) : '');
</script>

<header class="topbar" data-layout={layout}>
	{#if phone}
		<h1 class="sr-only">{strings.appName}</h1>
		<div class="title"><PlanChip {app} title subtitle={finish} /></div>
		<SyncStatus {app} sheet />
		<button
			type="button"
			class="project-button"
			aria-haspopup="dialog"
			title={strings.inspector.openProject}
			onclick={() => (app.inspector.projectOpen = true)}
		>
			<Icon name="sliders" size={17} />
			<span class="sr-only">{strings.inspector.projectSettings}</span>
		</button>
		<UndoRedo {app} phone />
		<StatusButton {app} {updates} {theme} />
		<LazyMount
			when={app.historyOpen}
			load={() => import('./HistorySheet.svelte')}
			props={{ app }}
		/>
	{:else}
		{#if drawer}
			<button
				type="button"
				class="outline-button"
				aria-haspopup="dialog"
				aria-expanded={app.outlineOpen}
				title={strings.panels.outlineOpen}
				onclick={() => (app.outlineOpen = true)}
			>
				<Icon name="panel" size={17} />
				<span class="sr-only">{strings.panels.outlineOpen}</span>
			</button>
		{/if}
		<h1 class="brand">
			<Mark size={26} />
			<span class="wordmark">{strings.appName}</span>
		</h1>
		<span class="rule" aria-hidden="true"></span>
		<div class="plan"><PlanChip {app} /></div>
		<SyncStatus {app} sheet={layout === 'tablet'} />
		<UndoRedo {app} />
		<div class="centre"><ModeSwitch {mode} {onmode} /></div>
		<button
			type="button"
			class="project-button"
			aria-haspopup="dialog"
			title={strings.inspector.openProject}
			onclick={() => (app.inspector.projectOpen = true)}
		>
			<Icon name="sliders" size={17} />
			<span class="sr-only">{strings.inspector.projectSettings}</span>
		</button>
		<HealthButton {app} layout={layout === 'desktop' ? 'desktop' : 'tablet'} />
		<EngineStatus state={app.engine} adaptive />
		<ThemeToggle {theme} />
	{/if}
</header>

<style>
	.topbar {
		container: topbar / inline-size;
		display: flex;
		align-items: center;
		gap: 12px;
		min-block-size: var(--size-topbar);
		padding: 0 20px;
	}
	/* The sync control (T14) is a sixth control here, and the brand mark is not drawn: the title gets the room (the gap stays 6 px, the sides are the original 18). */
	.topbar[data-layout='phone'] {
		gap: 6px;
		padding: calc(10px + env(safe-area-inset-top)) 18px 6px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0;
		font-weight: 400;
	}
	.wordmark {
		font-family: var(--font-display);
		font-size: 26px;
		letter-spacing: -0.01em;
		line-height: 1;
	}
	.rule {
		inline-size: 1px;
		block-size: 24px;
		margin-inline: 4px;
		background: var(--color-border-strong);
	}
	.plan {
		min-inline-size: 0;
		flex: 0 1 16rem;
	}
	/* The mode switch keeps its width: what is short of room is the plan chip, which ellipsises. */
	.centre {
		display: flex;
		justify-content: center;
		flex: 1 0 auto;
	}
	.title {
		flex: 1 1 auto;
		min-inline-size: 0;
	}
	.title :global(.chip) {
		max-inline-size: 100%;
	}
	.outline-button,
	.project-button {
		display: inline-flex;
		/* Never squeezed below the control size: on a phone the plan's name shrinks instead (10.3). */
		flex: none;
		align-items: center;
		justify-content: center;
		inline-size: var(--size-control);
		block-size: var(--size-control);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
		color: var(--color-text);
		cursor: pointer;
	}
	.outline-button:hover,
	.project-button:hover {
		background: var(--color-row-hover);
	}
	@container topbar (max-width: 899px) {
		.wordmark {
			display: none;
		}
		.rule {
			display: none;
		}
		.plan {
			flex-basis: 11rem;
		}
	}
</style>
