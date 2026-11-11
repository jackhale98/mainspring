// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Canonical JSON for golden comparison (phase-0 spec 6.3): keys sorted recursively, 2-space
 * indent, trailing newline. The implementation is shared with the native recorder
 * (engine/golden/lib.mjs), so a golden and a worker result are rendered by the same code.
 */
import {
	canonical as canonicalValue,
	canonicalJson as canonicalText,
} from '../../engine/golden/lib.mjs';

/** A copy of `value` with object keys sorted recursively. */
export function canonical(value: unknown): unknown {
	return canonicalValue(value);
}

/** The golden file format: sorted keys, 2-space indent, trailing newline. */
export function canonicalJson(value: unknown): string {
	return canonicalText(value);
}
