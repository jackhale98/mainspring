<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The theme toggle (ADR-0009): one icon button that cycles System, Light and Dark and shows the
	current choice with its icon. The state is src/lib/state/theme.svelte.ts and is remembered.
-->
<script lang="ts">
	import type { IconName } from '../../lib/icons';
	import { nextPref, type ThemePref } from '../../lib/state/theme';
	import type { ThemeState } from '../../lib/state/theme.svelte';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	let { theme }: { theme: ThemeState } = $props();

	const ICON: Record<ThemePref, IconName> = { system: 'system', light: 'sun', dark: 'moon' };
	const P = strings.theme.pref;
	const label = $derived(strings.theme.button(P[theme.pref], P[nextPref(theme.pref)]));
</script>

<button
	type="button"
	class="icon-button"
	data-testid="theme-toggle"
	data-pref={theme.pref}
	aria-label={label}
	title={label}
	onclick={() => theme.cycle()}
>
	<Icon name={ICON[theme.pref]} size={17} />
</button>

<style>
	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: var(--size-control);
		block-size: var(--size-control);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background-color var(--motion-fast);
	}
	.icon-button:hover {
		background: var(--color-row-hover);
		color: var(--color-text);
	}
</style>
