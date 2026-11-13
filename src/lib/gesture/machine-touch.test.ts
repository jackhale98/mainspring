// SPDX-License-Identifier: GPL-2.0-or-later
import {
	EMPTY,
	END_HANDLE,
	ESCAPE,
	LINK_DOT,
	PROGRESS,
	ROW_HANDLE,
	cancel,
	down,
	move,
	runCases,
	scroll,
	timer,
	up,
	type Case,
} from './testing';

const T = 'touch' as const;

const touch: Case[] = [
	{
		name: 'a quick touch is a tap',
		events: [down(T, 10, 10, 0), up(T, 10, 10, 120)],
		out: ['tap'],
		state: 'idle',
	},
	{
		name: 'holding 350 ms lifts the item (timer)',
		events: [down(T, 10, 10, 0), timer(350)],
		out: ['long-press'],
		state: 'armed',
	},
	{
		name: 'an early timer does nothing',
		events: [down(T, 10, 10, 0), timer(349)],
		out: [],
		state: 'pressed',
	},
	{
		name: 'a long-press is not a tap when released without moving',
		events: [down(T, 10, 10, 0), timer(350), up(T, 10, 10, 600)],
		out: ['long-press', 'drag-cancel'],
		state: 'idle',
	},
	{
		name: 'a lost timer is made up by the next event',
		events: [down(T, 10, 10, 0), up(T, 10, 10, 500)],
		out: ['long-press', 'drag-cancel'],
		state: 'idle',
	},
	{
		name: 'after the lift the next move drags, and the drop ends it',
		events: [
			down(T, 10, 10, 0),
			timer(350),
			move(T, 11, 10, 400),
			move(T, 90, 10, 420),
			up(T, 90, 10, 440),
		],
		out: ['long-press', 'capture', 'drag-start', 'drag-move', 'drag-move', 'release', 'drag-end'],
		state: 'idle',
	},
	{
		name: 'a little finger jitter inside 8 px before the timer keeps the long-press',
		events: [down(T, 10, 10, 0), move(T, 15, 14, 100), move(T, 12, 9, 200), timer(350)],
		out: ['long-press'],
		state: 'armed',
	},
	{
		name: 'moving more than 8 px before the timer is a scroll: pan-native, then cancel is swallowed',
		events: [down(T, 10, 10, 0), move(T, 10, 30, 100), cancel(T, 10, 30, 110), timer(350)],
		out: ['pan-native'],
		state: 'idle',
	},
	{
		name: 'native scrolling stays native for the rest of the press',
		events: [down(T, 10, 10, 0), move(T, 10, 30, 100), move(T, 10, 90, 500), up(T, 10, 90, 600)],
		out: ['pan-native'],
		state: 'idle',
	},
	{
		name: 'a scroll event before the timer cancels the press',
		events: [down(T, 10, 10, 0), scroll(100), timer(350), up(T, 10, 10, 400)],
		out: ['pan-native'],
		state: 'idle',
	},
	{
		name: 'scroll events during a drag (our own auto-scroll) are ignored',
		events: [down(T, 10, 10, 0), timer(350), move(T, 90, 10, 400), scroll(410)],
		out: ['long-press', 'capture', 'drag-start', 'drag-move'],
		state: 'dragging',
	},
	{
		name: 'a selected bar handle drags at once after 8 px, no long-press',
		events: [down(T, 10, 10, 0, { target: END_HANDLE }), move(T, 17, 10, 20), move(T, 19, 10, 30)],
		out: ['capture', 'drag-start', 'drag-move'],
		state: 'dragging',
	},
	{
		name: 'the link dot and the progress handle drag at once too',
		events: [down(T, 10, 10, 0, { target: LINK_DOT }), move(T, 30, 10, 20)],
		out: ['capture', 'drag-start', 'drag-move'],
		state: 'dragging',
	},
	{
		name: 'a progress handle tap is a tap',
		events: [down(T, 10, 10, 0, { target: PROGRESS }), up(T, 10, 10, 60)],
		out: ['tap'],
		state: 'idle',
	},
	{
		name: 'a handle the hook refuses needs the long-press like any other part',
		events: [down(T, 10, 10, 0, { target: END_HANDLE }), move(T, 40, 10, 20)],
		out: ['pan-native'],
		state: 'native',
		hooks: { canDrag: () => false },
	},
	{
		name: 'the row handle needs a long-press on touch',
		events: [down(T, 10, 10, 0, { target: ROW_HANDLE }), move(T, 10, 40, 100)],
		out: ['pan-native'],
		state: 'native',
	},
	{
		name: 'empty space on touch: a tap selects, a move scrolls',
		events: [down(T, 10, 10, 0, { target: EMPTY }), up(T, 10, 10, 80)],
		out: ['tap'],
		state: 'idle',
	},
	{
		name: 'empty space is never lifted, however long it is held',
		events: [down(T, 10, 10, 0, { target: EMPTY }), timer(350), move(T, 10, 60, 400)],
		out: ['pan-native'],
		state: 'native',
	},
	{
		name: 'a text-only bar long-press is reported and then never drags',
		events: [down(T, 10, 10, 0), timer(350), move(T, 90, 10, 400), up(T, 90, 10, 420)],
		out: ['long-press'],
		state: 'idle',
		hooks: { canDrag: () => false },
	},
	{
		name: 'pointercancel after the lift ends it',
		events: [down(T, 10, 10, 0), timer(350), cancel(T, 10, 10, 380)],
		out: ['long-press', 'drag-cancel'],
		state: 'idle',
	},
	{
		name: 'Escape after the lift ends it',
		events: [down(T, 10, 10, 0), timer(350), ESCAPE],
		out: ['long-press', 'drag-cancel'],
		state: 'idle',
	},
	{
		name: 'Escape before the lift is silent and the press never lifts',
		events: [down(T, 10, 10, 0), ESCAPE, timer(350), up(T, 10, 10, 400)],
		out: [],
		state: 'idle',
	},
	{
		name: 'a touch drag dropped near where it began cancels',
		events: [
			down(T, 10, 10, 0),
			timer(350),
			move(T, 90, 10, 400),
			move(T, 12, 12, 420),
			up(T, 12, 12, 440),
		],
		out: [
			'long-press',
			'capture',
			'drag-start',
			'drag-move',
			'drag-move',
			'release',
			'drag-cancel',
		],
		state: 'idle',
	},
];

runCases('gesture machine: touch', touch);
