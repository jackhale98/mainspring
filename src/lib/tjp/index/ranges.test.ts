// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TEXT_ONLY_PRIORITY, findTextOnly, type TextOnly, type TextOnlyReason } from '../text-only';
import { blockingIn, rangeIndex, stronger } from './ranges';

const t = (
	reason: TextOnlyReason,
	from: number,
	to: number,
	within: [number, number] | null = null,
): TextOnly => ({
	reason,
	at: { file: 'f', from, to },
	within: within && { from: within[0], to: within[1] },
});

describe('blockingIn', () => {
	it('finds containing, crossing and contained ranges like findTextOnly', () => {
		const idx = rangeIndex([
			t('opaque', 10, 20, [5, 25]),
			t('syntax-error', 0, 100),
			t('macro-call', 40, 45),
		]);
		expect(blockingIn(idx, 12, 14)?.reason).toBe('syntax-error');
		expect(blockingIn(rangeIndex([t('opaque', 10, 20, [5, 25])]), 5, 25)).toBeNull();
		expect(blockingIn(rangeIndex([t('opaque', 10, 20, [5, 25])]), 15, 15)?.reason).toBe('opaque');
		expect(blockingIn(rangeIndex([t('opaque', 10, 20)]), 20, 20)).toBeNull();
	});

	it('agrees with findTextOnly on random ranges', () => {
		const reason = fc.constantFrom(...TEXT_ONLY_PRIORITY);
		const range = fc
			.tuple(reason, fc.nat(60), fc.nat(20), fc.option(fc.tuple(fc.nat(10), fc.nat(10))))
			.map(([r, from, len, w]) =>
				t(r, from, from + len + 1, w && [from - w[0], from + len + 1 + w[1]]),
			);
		fc.assert(
			fc.property(fc.array(range, { maxLength: 12 }), fc.nat(80), fc.nat(15), (list, from, len) => {
				const to = from + (len % 3 === 0 ? 0 : len);
				const a = blockingIn(rangeIndex(list), from, to);
				const b = findTextOnly(list, 'f', from, to);
				expect(a?.reason ?? null).toBe(b?.reason ?? null);
			}),
			{ numRuns: 500 },
		);
	});

	it('stronger keeps the higher priority', () => {
		expect(stronger(t('opaque', 0, 1), t('macro-id', 0, 1))?.reason).toBe('macro-id');
		expect(stronger(null, t('opaque', 0, 1))?.reason).toBe('opaque');
		expect(stronger(t('syntax-error', 0, 1), t('macro-id', 0, 1))?.reason).toBe('syntax-error');
	});
});
