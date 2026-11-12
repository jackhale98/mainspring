# ADR-0008: Unified undo and interaction defaults

Status: accepted by the user, 2026-11-12 ("Approve as recommended"). Source:
`docs/phases/phase-2.md` sections 6.7, 7.2, 18.4, 18.5, 18.6, 18.8 and 19.2.

## Context

Phase 1 gives the editor CodeMirror's own history, one stack per file. Visual edits go
through the edit API. Each edit carries an inverse and version checks (phase-1 section 6.5).
A plan can have text and visual edits in two files, so a per-file undo cannot reverse a
visual edit while the user types in another file.

Three interaction defaults are also open:

- a Gantt move needs a default: a task with a driving dependency, or one without;
- the UI preferences need a home and defaults per device;
- on touch, a long-press before every drag is slow for a bar that is already selected.

## Decision

1. **Unified undo (18.6, section 6.7).** CodeMirror's per-file history is removed. Mod-Z,
   Mod-Shift-Z and Mod-Y call one undo stack for the workspace, in the editor and elsewhere.
   - Each visual edit is one entry. Typing in the same file joins a group if it follows the
     last keystroke within 500 ms.
   - Undo and redo use the edit API's inverse and version checks.
   - If a file changed outside the history, both stacks are cleared. The app does not apply
     an inverse it cannot trust.
   - Each visual edit shows a toast with Undo. Undo works while that entry is the top entry.
2. **Move preference (18.4, 19.2).** The first move asks once which kind to use, and the
   answer is remembered.
   - `gap` writes `gaplength` on the driving dependency. It is pre-selected when the task has
     a driving dependency.
   - `start` writes a `start` attribute. It is pre-selected otherwise, and it warns once that
     this creates a constraint.
   - An ALAP task always writes `end`, because TaskJuggler anchors it at the end.
3. **UI preferences (18.5).** Mode, zoom, collapse state, the split divider and the move
   preference are stored in `localStorage`, one set per sample. Defaults:
   - Split on desktop;
   - Visual on tablet;
   - the Gantt tab on phone.

   No plan text is stored. Nothing else is persisted in Phase 2.
4. **Touch handles (18.8, section 7.2).** On touch, the visible handles of a selected bar
   (end, link and progress) drag at once after an 8 px slop. Every other drag needs a 350 ms
   long-press. Mouse and pen keep their own rule: a drag starts after 3 px (pen 4 px).

## Consequences

- Text-mode undo becomes global. Undo in Text mode can reverse a visual edit in another
  file, and the toast or status names that file. Text-mode end-to-end tests change to match.
- The undo property tests cover mixed sequences of text and visual edits. A change that
  bypasses the history must give the `diverged` outcome in tests.
- The move question appears once per user, not once per drag.
- The touch rule needs a non-passive `touchmove` listener on the timeline. Its frame cost is
  measured on the device (section 8.2). If it costs frames, the fallback (touch-action none on
  the selected bar's handles only) needs its own ADR (19.4).
- Preferences are local to one browser. Nothing is synced, and no plan text leaves the
  device through this path.
