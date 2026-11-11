// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Node props of the TJP grammar. `stringTemplate` sits on the `TemplateString` node types and says
 * what TaskJuggler's scanner expands inside the string: macro calls (`${…}`), environment
 * references (`$(NAME)`) or both. The document layer uses it for the text-only reason (5.4 X2:
 * `macro-call` or `env-var`).
 */
import { NodeProp } from '@lezer/common';

export interface StringTemplate {
	readonly macro: boolean;
	readonly env: boolean;
}

export const stringTemplate = new NodeProp<StringTemplate>({
	deserialize: (s) => ({ macro: s.includes('macro'), env: s.includes('env') }),
});
