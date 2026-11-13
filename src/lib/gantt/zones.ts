// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A memo over the time-zone host (`Intl` formatting is the slow part of header ticks and of the
 * calendar): the offset of a zone changes only at a handful of instants, so it is looked up once
 * per 15-minute bucket. A bucket across which the offset changes is not cached, so the answer is
 * always the host's.
 */
import type { ZoneOffsets } from '../tjp/values';

export const BUCKET_SECONDS = 900;
const MAX_ENTRIES = 20_000;

export function memoZones(host: ZoneOffsets, bucket = BUCKET_SECONDS): ZoneOffsets {
	const cache = new Map<string, number>();
	return {
		valid: (zone) => host.valid(zone),
		offset(zone, epochSeconds) {
			const start = Math.floor(epochSeconds / bucket) * bucket;
			const key = `${zone}|${start}`;
			const known = cache.get(key);
			if (known !== undefined) return known;
			const at = host.offset(zone, epochSeconds);
			// The offset at both ends of the bucket: equal means it holds throughout.
			if (host.offset(zone, start) === at && host.offset(zone, start + bucket - 1) === at) {
				if (cache.size >= MAX_ENTRIES) cache.clear();
				cache.set(key, at);
			}
			return at;
		},
	};
}
