// SPDX-License-Identifier: GPL-2.0-or-later
// The e2e jobs run in Playwright's own image, whose browsers are built for one Playwright version:
// a tag that differs from the one in package-lock.json fails every shard with a missing browser.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const IMAGE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/g;

describe('the Playwright image in the workflows', () => {
	it('has the tag of the Playwright version in package-lock.json', () => {
		const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as {
			packages: Record<string, { version?: string }>;
		};
		const version = lock.packages['node_modules/playwright']?.version;
		expect(version).toMatch(/^\d+\.\d+\.\d+$/);
		const dir = path.join(ROOT, '.github', 'workflows');
		const tags = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith('.yml'))
			.flatMap((f) => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(IMAGE)])
			.map((m) => m[1]);
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) expect(tag).toBe(version);
	});
});
