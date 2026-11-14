# Backlog after v1

These are ideas the user wants after the v1 release. They are not in any phase spec. Each one
needs an ADR that the user approves before work starts (CLAUDE.md). As with every view, these
edit through the `src/lib/tjp` edit API: the `.tjp` text stays the source of truth, and a change
in any view becomes a minimal text patch.

| Idea | Raised | Notes |
| --- | --- | --- |
| **Grid view.** A spreadsheet-style task table. You edit cells in place (name, effort, duration, dates, people, priority, complete, notes and custom attributes), paste rows, fill down, and sort and filter. | User, 2026-11-13 | Builds on the Phase 2 treegrid (T18) and the edit API's existing intents (attribute, rename, add and move). A pasted block becomes one grouped edit, so one undo reverts it. Bulk edit across a selection is already in the "Later" column of the product scope. |
| **Kanban board.** Tasks as cards in columns, dragged between columns. | User, 2026-11-13 | TaskJuggler has no status field, so the column has to map to something in the text. Options: `complete` ranges (to do 0, doing 1–99, done 100), a custom attribute declared with `extend task`, or a flag. The ADR picks the default and lets a plan choose. A card's dates stay the scheduler's; the board never moves them. |
| **Choosable Gantt columns.** Choose which columns sit left of the Gantt: id, name, effort, duration, start, end, people, complete, float (estimate), priority, custom attributes. Reorder them, resize them, and save the choice per plan. | User, 2026-11-13 | Phase 2 ships fixed outline columns (T18). This adds a column picker, widths, and a store for the choice: UI preferences per ADR-0008, not the plan text. A phone keeps the single frozen name column. |
| **More task editing like other planning tools.** | User, 2026-11-13 | To be scoped with the user against what MS Project, OmniPlan and similar tools offer, mapped to TaskJuggler keywords. The v1 visual-editing column already covers allocation alternatives, limits, `onstart` and `onend` links, and custom attributes. |
| **Dependency view for the selected task.** Highlight the selected task's chain of predecessors and successors (direct, or the whole chain) on the Gantt and dim the rest; optionally a compact list of the chain. | User, 2026-11-14 | Builds on the Gantt's existing dimming (the critical-path view) and the dependency graph the edit API already has (`src/lib/tjp/edit/dep-graph.ts`). Nothing in it gets harder later. Needs an ADR for where the toggle lives and whether it follows the selection. |
