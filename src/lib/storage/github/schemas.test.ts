// SPDX-License-Identifier: GPL-2.0-or-later
// The GitHub call bodies (phase-4.md 7.3): compile checks (`npm run typecheck` enforces them).
// The fake's responses are checked against GitHub's OpenAPI description by T9's drift test.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { GITHUB_ENDPOINTS, type GitHubEndpointName } from './endpoints';
import type {
	AccessTokenResponse,
	GitHubBody,
	GitHubIo,
	GitHubResponse,
	GitRef,
	GitTreeWrite,
} from './schemas';

describe('GitHub bodies (7.3)', () => {
	it('has one entry per endpoint of the table', () => {
		expectTypeOf<keyof GitHubIo>().toEqualTypeOf<GitHubEndpointName>();
		expect(Object.keys(GITHUB_ENDPOINTS).length).toBe(13);
	});

	it('sends a body only with the calls that write', () => {
		expectTypeOf<GitHubBody<'ref'>>().toEqualTypeOf<null>();
		expectTypeOf<GitHubBody<'tree'>>().toEqualTypeOf<null>();
		expectTypeOf<GitHubBody<'createBlob'>>().toEqualTypeOf<{
			readonly content: string;
			readonly encoding: 'base64';
		}>();
		expectTypeOf<GitHubBody<'createCommit'>['parents']>().toEqualTypeOf<readonly string[]>();
	});

	it('never forces a branch update, and writes blobs only into a tree', () => {
		expectTypeOf<GitHubBody<'updateRef'>>().toEqualTypeOf<{
			readonly sha: string;
			readonly force: false;
		}>();
		expectTypeOf<GitTreeWrite['type']>().toEqualTypeOf<'blob'>();
		// GitHub deletes a path given `sha: null`; the type allows a blob's sha only (21, 8.1 #5).
		expectTypeOf<GitTreeWrite['sha']>().toEqualTypeOf<string>();
		expectTypeOf<GitHubResponse<'updateRef'>>().toEqualTypeOf<GitRef>();
		// @ts-expect-error: `force: true` is not a body the type allows.
		const forced: GitHubBody<'updateRef'> = { sha: 'abc', force: true };
		expect(forced.sha).toBe('abc');
	});

	it('tells a token from a device-flow error by its fields', () => {
		const pending: AccessTokenResponse = { error: 'authorization_pending' };
		const token: AccessTokenResponse = {
			access_token: 'x',
			token_type: 'bearer',
			expires_in: 28_800,
			refresh_token: 'y',
		};
		expect('error' in pending && pending.error).toBe('authorization_pending');
		expect('access_token' in token).toBe(true);
	});
});
