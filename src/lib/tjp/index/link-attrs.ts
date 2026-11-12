// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Attributes inside task, resource and supplement bodies (link.ts): own sites (with the X4 reason
 * of an enclosing unresolved declaration), list references, leaves, working hours and custom
 * attribute uses. References wait for the end of the walk (link-finish.ts), so that they also
 * reach declarations only expansion makes (X5). `allocate` looks the resource up with
 * `resourceprefix` applied (rule_allocationHeader, TjpSyntaxRules.rb:372, 4784); TaskJuggler
 * needs it declared before the allocation, which the index does not check.
 */
import type { AttrFact, ListItemFact } from './facts';
import type { LinkState, Scope } from './link-state';
import { stronger } from './ranges';
import type { Prefix } from './types';

/** An attribute in a task, resource or supplement body. */
export function declAttr(
	s: LinkState,
	fact: AttrFact,
	scope: Extract<Scope, { kind: 'decl' }>,
	resourcePrefix: Prefix,
): void {
	const x4 = scope.x4;
	const base = fact.site;
	const site =
		x4 && stronger(base.textOnly, x4) !== base.textOnly
			? base.withTextOnly(stronger(base.textOnly, x4))
			: base;
	scope.sym?.attrs.push(site);
	const owner = scope.prop;
	const kw = site.keyword;
	if (fact.custom) {
		s.customAttributeUses.push({
			scope: owner.kind,
			name: kw,
			statement: site.statement,
			nameAt: fact.custom,
			owner: owner.id,
			declared: false,
		});
		return;
	}
	if (fact.items.length === 0 && kw !== 'workinghours') return;
	const lookup = (it: ListItemFact): string | null =>
		it.path === null || resourcePrefix.kind === 'unknown'
			? null
			: resourcePrefix.kind === 'id'
				? `${resourcePrefix.id}.${it.path}`
				: it.path;
	switch (kw) {
		case 'depends':
		case 'precedes':
			if (owner.kind !== 'task') return;
			for (const item of fact.items) s.pendingDeps.push({ form: kw, item, owner, attr: site, x4 });
			return;
		case 'allocate':
			if (owner.kind !== 'task') return;
			for (const item of fact.items) {
				s.pendingResourceRefs.push({ item, lookup: lookup(item), owner, via: kw, x4, attr: site });
			}
			return;
		case 'responsible':
		case 'managers':
			for (const item of fact.items)
				s.pendingResourceRefs.push({ item, lookup: lookup(item), owner, via: kw, x4 });
			return;
		case 'flags':
			for (const it of fact.items) {
				const target = it.path !== null && s.flags.has(it.path) ? it.path : null;
				s.references.push({
					kind: 'flag',
					target,
					written: it.written,
					at: it.ref,
					via: 'flags',
					owner: owner.id,
					textOnly: stronger(it.textOnly, x4),
				});
			}
			return;
		case 'leaves':
		case 'vacation':
			if (owner.kind === 'resource')
				s.addLeave({ kind: 'resource', resource: owner.id }, site, fact);
			return;
		case 'workinghours':
			if (owner.kind === 'resource')
				s.workingHours.push({ scope: { kind: 'resource', resource: owner.id }, attr: site });
			return;
		default:
			return;
	}
}
