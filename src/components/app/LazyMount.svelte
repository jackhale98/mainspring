<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Mounts a component that is imported when it is first needed, and keeps it mounted: the sheets
	and dialogs that nothing needs at first paint (History, Docs, New plan, Project, Source, the
	move question). It is how those stay out of the first-load JS (phase-2.md 11.3, the JS budget).

	`when` turns true the first time the piece is wanted; the chunk is fetched then, and the piece
	mounts with `props` as soon as it arrives, so it sees the state that asked for it. Nothing shows
	until then (a few milliseconds from the cache, longer on a slow network). If the import fails,
	nothing is mounted and `onfail` runs; the next time `when` turns true the import is tried again,
	so going online and asking again works. A piece that is waiting on a person (the move question)
	passes `onfail` to let the person's action fall back instead of hanging.
-->
<script lang="ts">
	import type { Component } from 'svelte';

	// The piece's own props type is checked where it is written (its component); this wrapper only
	// forwards them, so it takes any component.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type Piece = Component<any>;
	interface Props {
		load: () => Promise<{ default: Piece }>;
		when: boolean;
		props: Record<string, unknown>;
		onfail?: () => void;
	}
	let { load, when, props, onfail }: Props = $props();

	let View = $state.raw<Piece | null>(null);
	let loading = false;

	$effect(() => {
		if (!when || View !== null || loading) return;
		loading = true;
		load().then(
			(m) => {
				loading = false;
				View = m.default;
			},
			() => {
				loading = false;
				onfail?.();
			},
		);
	});
</script>

{#if View}<View {...props} />{/if}
