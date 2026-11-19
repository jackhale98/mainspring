// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The resource table's state and commands (phase-3.md 9.6, 7.1 W6 and W7). The component draws
 * the rows; every change of the plan is here and goes through the edit dispatcher (`app.edits`),
 * so it is one text patch, one undo step and one toast (a quiet strip on a phone).
 *
 * - **Rows** are the outline's resource tree with the collapsed groups taken out (`openRows`),
 *   what each shows (`tableRows`), and the tree the drag and the keys walk (`treeOf`).
 * - **Select** sets the shared selection (`selectResource`), so the right panel, the lanes and the
 *   text follow; a sheet layout opens the details on a second tap (`InspectorState.tap`).
 * - **Regroup** (W6): a drop plans with `planRegroup` on the tree shown and sends the intent with the
 *   outline's version, so the dispatcher refuses a place the text has since changed; a refusal of
 *   the planner is a toast with "Show in text", the edit API's refusals come back as the
 *   dispatcher's own. The keys and the menu send `stepResourcePlan`, planned on the text now.
 * - **Add** (W7) asks for the name first, then one `addResource` edit (add.ts says why), placed by
 *   `addResourcePlan` on the text now.
 * - The table never waits for the index (ADR-0018): the dispatcher resolves every target.
 */
import { stepTarget, rootsOf, type Step } from '../../lib/gantt/reorder';
import { runIntent, runPlan } from '../../lib/calendar/run';
import { addResourceFlow } from '../../lib/resources/add';
import { deleteEdit, renameEdit } from '../../lib/resources/person-edit';
import { addResourcePlan, stepResourcePlan } from '../../lib/resources/plans';
import { planRegroup } from '../../lib/resources/regroup';
import { dropRows, openRows, tableRows, treeOf, type TableRow } from '../../lib/resources/rows';
import { headerOfEdit } from '../../lib/people/add-person';
import type { AppState } from '../../lib/state/app.svelte';
import type { OutlineNode } from '../../lib/state/outline';
import { resourceStrings as R } from '../../lib/strings-resources';

export type AddKind = 'person' | 'group';

export class ResourceTable {
	readonly #app: AppState;
	readonly #confirm: (message: string) => boolean;

	/** Groups whose members are hidden, by outline key. Kept while the view is mounted. */
	collapsed = $state.raw<ReadonlySet<string>>(new Set());
	/** The row with the tab stop (roving focus), by outline key. */
	focusKey = $state<string | null>(null);
	/** The row being renamed in place, by key. */
	renaming = $state<string | null>(null);
	/** The add form that is open, if any. */
	adding = $state<AddKind | null>(null);
	/** A new sentence is spoken once by the live region. */
	announcement = $state('');

	/** The outline's resource nodes, the visible rows, the tree and its roots, and the selected key. */
	readonly nodes: readonly OutlineNode[];
	readonly rows: TableRow[];
	readonly tree: ReadonlyMap<string, OutlineNode>;
	readonly roots: readonly string[];
	/** The selected person's outline key, or null. */
	readonly selectedKey: string | null;

	constructor(app: AppState, confirm: (message: string) => boolean = (m) => globalThis.confirm(m)) {
		this.#app = app;
		this.#confirm = confirm;
		this.nodes = $derived(app.outline.resources);
		this.rows = $derived.by(() =>
			tableRows(openRows(this.nodes, this.collapsed), app.index, app.run?.lastGood?.result ?? null),
		);
		this.tree = $derived(treeOf(this.nodes));
		this.roots = $derived(
			rootsOf(
				this.tree,
				this.nodes.map((n) => n.key),
			),
		);
		this.selectedKey = $derived.by(() => {
			const s = app.selection.current;
			return s?.kind === 'resource' ? `resource:${s.id}` : null;
		});
	}

	dropRows = () => dropRows(this.rows, this.#app.index);

	toggle(key: string): void {
		const next = new Set(this.collapsed);
		if (!next.delete(key)) next.add(key);
		this.collapsed = next;
	}

	open(key: string): void {
		if (!this.collapsed.has(key)) return;
		const next = new Set(this.collapsed);
		next.delete(key);
		this.collapsed = next;
	}

	/** A tap or click on a row: selects it; a sheet layout opens the details on the second tap. */
	select(key: string): void {
		const node = this.tree.get(key);
		if (!node || node.id === null) return;
		const already = this.selectedKey === key;
		this.focusKey = key;
		this.#app.selection.selectResource(node.id, 'visual');
		this.#app.inspector.tap(already);
	}

	/** Enter on a row: select it and move the keyboard into the details. */
	openDetails(key: string): void {
		const node = this.tree.get(key);
		if (!node || node.id === null) return;
		this.focusKey = key;
		this.#app.selection.selectResource(node.id, 'visual');
		this.#app.inspector.focus();
	}

	async rename(key: string, typed: string): Promise<boolean> {
		const node = this.tree.get(key);
		const edits = this.#app.edits;
		this.renaming = null;
		const name = typed.trim();
		if (!node || node.id === null || !edits || name === '' || name === node.name) return false;
		const e = renameEdit(node.id, node.name ?? node.id, name);
		const o = await runIntent(edits, e.intent, e.label, this.#confirm);
		return o.status === 'applied';
	}

	async remove(key: string): Promise<boolean> {
		const node = this.tree.get(key);
		const edits = this.#app.edits;
		if (!node || node.id === null || !edits) return false;
		const next = this.#neighbour(key);
		const e = deleteEdit(node.id, node.name ?? node.id, this.#app.index);
		const o = await runIntent(edits, e.intent, e.label, this.#confirm);
		if (o.status !== 'applied') return false;
		this.focusKey = next;
		this.#app.selection.clear();
		this.announcement = R.table.deleted(node.name ?? node.id);
		return true;
	}

	/** The row the focus goes to when `key` goes: the next one, else the one before. */
	#neighbour(key: string): string | null {
		const i = this.rows.findIndex((r) => r.node.key === key);
		return (this.rows[i + 1] ?? this.rows[i - 1])?.node.key ?? null;
	}

	/**
	 * W6: moves a resource to `index` among the children of `parentKey` (null: the top level), the
	 * place of a drop. It was read from the tree shown, whose index version (the outline's) is the
	 * move's `basedOn`: when the text has since changed that place, the dispatcher refuses the move
	 * (`target-changed`) and says so (ADR-0018).
	 */
	async regroup(
		key: string,
		parentKey: string | null,
		index: number,
		basedOn: number = this.#app.outline.version,
	): Promise<boolean> {
		const edits = this.#app.edits;
		const node = this.tree.get(key);
		const idx = this.#app.index;
		if (!edits || !node || node.id === null || !idx) return false;
		const parent = parentKey === null ? null : (this.tree.get(parentKey)?.id ?? null);
		const plan = planRegroup(idx, node.id, parent, index);
		if (plan.status === 'not-possible') {
			edits.refuse(plan.message, plan.at, idx.version);
			this.announcement = plan.message;
			return false;
		}
		const o = await runIntent(edits, plan.intent, plan.label, this.#confirm, basedOn);
		if (o.status === 'applied') {
			if (parentKey !== null) this.open(parentKey);
			this.focusKey = key;
			this.announcement = plan.label.text;
		} else if (o.status === 'refused') this.announcement = o.message;
		return o.status === 'applied';
	}

	/**
	 * Alt+Shift+Arrow, and the menu's Up, Down, Indent and Outdent: one place along the tree. At an
	 * edge of the tree shown, it says so without sending; otherwise the dispatcher plans the step on
	 * the text now (`stepResourcePlan`, ADR-0018), however far the shown tree lags it.
	 */
	async step(key: string, step: Step): Promise<boolean> {
		const node = this.tree.get(key);
		const edits = this.#app.edits;
		if (!edits || !node || node.id === null) return false;
		if (!stepTarget(this.tree, key, step, this.roots)) {
			this.announcement = R.table.nowhere(step);
			return false;
		}
		const o = await runPlan(edits, stepResourcePlan(node.id, step), this.#confirm);
		if (o.status === 'applied') {
			const made = o.edit.intent;
			if (made.type === 'moveResource' && made.parent !== null)
				this.open(`resource:${made.parent}`);
			this.focusKey = key;
			this.announcement = edits.toasts.find((t) => t.id === o.toast)?.text ?? '';
		} else if (o.status === 'refused' || o.status === 'noop') this.announcement = o.message;
		return o.status === 'applied';
	}

	startAdd(kind: AddKind): void {
		this.adding = kind;
	}

	cancelAdd(): void {
		this.adding = null;
	}

	/** Adds the person or group named `typed` (W7); the new row is selected and has the focus. */
	async commitAdd(typed: string): Promise<boolean> {
		const kind = this.adding;
		const app = this.#app;
		if (kind === null) return false;
		const at = this.selectedKey === null ? null : (this.tree.get(this.selectedKey)?.id ?? null);
		const added = await addResourceFlow(
			{
				plan: () => app.edits,
				add: (name, k) =>
					app.edits
						? app.edits.dispatchPlan(addResourcePlan(at, k, name))
						: Promise.resolve({ status: 'cancelled' }),
				headerOf: (edit) => headerOfEdit(app, edit),
				select: (rid) => app.selection.selectResource(rid, 'visual'),
			},
			typed,
			kind,
		);
		if (added === null) return false;
		this.adding = null;
		this.focusKey = `resource:${added.id}`;
		if (added.parent !== null) this.open(`resource:${added.parent}`);
		return true;
	}
}
