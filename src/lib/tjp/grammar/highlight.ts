// SPDX-License-Identifier: GPL-2.0-or-later
/** Highlighting tags for the TJP grammar's nodes (@lezer/highlight), phase-1.md 5.2. */
import { styleTags, tags as t } from '@lezer/highlight';

export const tjpHighlighting = styleTags({
	Keyword: t.keyword,
	AttributeName: t.attributeName,
	ScenarioPrefix: t.namespace,
	SupplementKind: t.typeName,
	'Id/Identifier': t.definition(t.variableName),
	'TaskRef/Identifier TaskRef/AbsoluteId ResourceRef/Identifier ResourceRef/AbsoluteId':
		t.variableName,
	'Ref/Identifier Ref/AbsoluteId Flag/Identifier': t.variableName,
	'LeaveType/Identifier': t.atom,
	Identifier: t.name,
	AbsoluteId: t.name,
	'String TemplateString': t.string,
	MacroBody: t.special(t.content),
	'MacroCall MacroWord EnvRef': t.macroName,
	'Integer Float': t.number,
	'Date Time': t.literal,
	Unit: t.unit,
	LineComment: t.lineComment,
	BlockComment: t.blockComment,
	'OpenBrace CloseBrace': t.brace,
	'OpenParen CloseParen': t.paren,
	Comma: t.separator,
	'Bang Minus Plus Percent': t.operator,
	Punct: t.punctuation,
	ScanError: t.invalid,
});
