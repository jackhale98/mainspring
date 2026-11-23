// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The `localStorage` key of the eviction marker's other half (phase-4.md 9.4): local-store.ts sets
 * and clears it, and the app reads it on start to know that plans were kept here (a module of its
 * own, so that reading it does not bring the store into a first load).
 */
export const MARKER_KEY = 'mainspring.stored';
