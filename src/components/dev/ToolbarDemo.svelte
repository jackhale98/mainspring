<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Dev page only (/dev/primitives): the three toolbars of the app with fake data and no engine, each
	in a host that has the container the real view gives it (the Gantt, the Workload and Lanes views,
	the Calendar), whose width `width` sets (null: the viewport's). tests/e2e/primitives/toolbar.spec.ts
	checks from 360 to 1600 px that every control is on one row and has declared its narrow form.
-->
<script lang="ts">
	import { ChipDrag } from '../gantt/chip-drag.svelte';
	import GanttToolbar from '../gantt/GanttToolbar.svelte';
	import CalendarBar from '../calendar/CalendarBar.svelte';
	import ViewSwitcher from '../people/ViewSwitcher.svelte';
	import WorkloadBar from '../workload/WorkloadBar.svelte';
	import { chipOf } from '../../lib/gantt/analysis';
	import type { ZoomLevel } from '../../lib/gantt/scale';
	import { ZOOM_PRESETS } from '../../lib/gantt/scale';
	import type { View } from '../../lib/state/selection.svelte';
	import type { BucketKind } from '../../lib/workload/types';

	interface Props {
		/** The toolbars' host width in px; null follows the viewport. */
		width: number | null;
		/** Not a phone: the Gantt's people picker and the view switcher, which a phone does not have. */
		picker: boolean;
	}
	let { width, picker }: Props = $props();

	const PEOPLE = ['Ana Ruiz', 'Ben Okoro', 'Cai Lin', 'Dee Park'].map((name, index) => ({
		id: `r${index}`,
		name,
		index,
	}));
	const drag = new ChipDrag({
		rowAt: () => null,
		drop: () => undefined,
		announce: () => undefined,
	});

	let level = $state<ZoomLevel>('week');
	let view = $state<View>('gantt');
	let zoom = $state<BucketKind>('week');
	let mode = $state<'select' | 'paint' | 'erase'>('select');
	let type = $state<'holiday' | 'annual' | 'special' | 'sick' | 'unpaid' | 'unemployed'>('holiday');
	let scope = $state<{ kind: 'global' } | { kind: 'resource'; resource: string }>({
		kind: 'global',
	});
	const style = $derived(width === null ? '' : `inline-size:${width}px`);
	const lines = { today: 'on', status: 'on', merged: false } as const;
</script>

<div class="host gantt" data-testid="toolbar-gantt" {style}>
	<GanttToolbar
		pxPerDay={ZOOM_PRESETS[level]}
		selected={{ text: 'Research, 3 Nov to 14 Nov, Ana Ruiz', note: null }}
		hover={{ text: '', note: null }}
		hasMarker
		{lines}
		dimmed={false}
		critical={chipOf(null, false)}
		onlevel={(l) => (level = l)}
		ontoday={() => undefined}
		oncritical={() => undefined}
		people={picker
			? {
					people: PEOPLE,
					booked: new Set<string>(),
					hasTask: true,
					drag,
					recent: PEOPLE.slice(0, 3),
					assigning: null,
					onpick: () => undefined,
					onpickkey: () => undefined,
					ondone: () => undefined,
				}
			: undefined}
		filter={{
			people: PEOPLE,
			flags: [{ flag: 'urgent', count: 3 }],
			person: null,
			flag: null,
			matches: null,
			onperson: () => undefined,
			onflag: () => undefined,
			onclear: () => undefined,
		}}
		add={{ hasSelection: true, canSubtask: true, onadd: () => undefined }}
		rowActions={{
			actions: [
				{ id: 'up', label: 'Move up', show: 'Alt+Shift+↑' },
				{ id: 'down', label: 'Move down', show: 'Alt+Shift+↓' },
				{ id: 'rename', label: 'Rename', show: 'F2' },
			],
			disabled: false,
			onaction: () => undefined,
		}}
	>
		{#snippet lead()}
			{#if picker}<ViewSwitcher {view} scope="dev" onchange={(v) => (view = v)} />{/if}
		{/snippet}
	</GanttToolbar>
</div>

<div class="host workload" data-testid="toolbar-workload" {style}>
	<WorkloadBar
		variant="heat"
		{zoom}
		onzoom={(z) => (zoom = z)}
		ontoday={() => undefined}
		hasToday
		dimmed={false}
		hover=""
		selected=""
		{lines}
		scope="dev-heat"
	/>
</div>

<div class="host workload" data-testid="toolbar-lanes" {style}>
	<WorkloadBar
		variant="lanes"
		{zoom}
		onzoom={(z) => (zoom = z)}
		ontoday={() => undefined}
		hasToday
		dimmed={false}
		hover=""
		selected=""
		{lines}
		scope="dev-lanes"
	/>
</div>

<div class="host calendar" data-testid="toolbar-calendar" {style}>
	<CalendarBar
		{scope}
		people={PEOPLE.map((p) => ({ id: p.id, name: p.name, level: 1 }))}
		{mode}
		leaveType={type}
		title="November 2026"
		hasToday
		onscope={(s) => (scope = s)}
		onmode={(m) => (mode = m)}
		ontype={(t) => (type = t)}
		onprev={() => undefined}
		onnext={() => undefined}
		ontoday={() => undefined}
		placement="top"
		hint="Select days, then paint or erase leave."
	/>
</div>

<style>
	.host {
		margin-block-end: var(--space-3);
		max-inline-size: 100%;
		border: 1px dashed var(--color-border);
	}
	.host.gantt {
		container: gantt / inline-size;
	}
	.host.workload {
		container: workload / inline-size;
	}
	.host.calendar {
		container: calendar / inline-size;
	}
</style>
