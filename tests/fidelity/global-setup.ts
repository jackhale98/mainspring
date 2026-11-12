// SPDX-License-Identifier: GPL-2.0-or-later
// Vitest global setup of `test:fidelity`: clears the parts of an earlier run, and after the run merges
// the parts the test files wrote (text-only properties, P4, mutation meta-test) into the report.
import fs from 'node:fs';
import path from 'node:path';
import {
	readPart,
	renderReport,
	RESULTS,
	type MutationPart,
	type P4Part,
	type TextPart,
} from './stats';

export default function setup(): () => void {
	fs.rmSync(path.join(RESULTS, 'fidelity'), { recursive: true, force: true });
	return () => {
		const text = readPart<TextPart>('text');
		const p4 = readPart<P4Part>('p4');
		const mutation = readPart<MutationPart>('mutation');
		fs.mkdirSync(RESULTS, { recursive: true });
		fs.writeFileSync(path.join(RESULTS, 'fidelity-report.md'), renderReport(text, p4, mutation));
		fs.writeFileSync(
			path.join(RESULTS, 'fidelity-report.json'),
			`${JSON.stringify({ text, p4, mutation }, null, 2)}\n`,
		);
	};
}
