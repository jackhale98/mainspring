// SPDX-License-Identifier: GPL-2.0-or-later
// The GitHub endpoint table (phase-4.md 7.3): the list itself, `githubUrl` and its inverse
// `matchGitHubRequest`, and compile checks of the parameter types.
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	branchRef,
	DEVICE_VERIFICATION_URL,
	GITHUB_API_ORIGIN,
	GITHUB_API_VERSION,
	GITHUB_ENDPOINTS,
	githubUrl,
	matchGitHubRequest,
	SIGN_IN_RELAY,
	type EndpointParams,
	type EndpointQuery,
	type GitHubEndpointName,
	type PathParams,
} from './endpoints';

/** 7.3's table, plus `branches` (contract notes), as method and OpenAPI path. */
const EXPECTED: Record<GitHubEndpointName, string> = {
	user: 'GET /user',
	installations: 'GET /user/installations',
	installationRepos: 'GET /user/installations/{installation_id}/repositories',
	userRepos: 'GET /user/repos',
	branches: 'GET /repos/{owner}/{repo}/branches',
	ref: 'GET /repos/{owner}/{repo}/git/ref/{ref}',
	commit: 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
	tree: 'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
	blob: 'GET /repos/{owner}/{repo}/git/blobs/{file_sha}',
	createBlob: 'POST /repos/{owner}/{repo}/git/blobs',
	createTree: 'POST /repos/{owner}/{repo}/git/trees',
	createCommit: 'POST /repos/{owner}/{repo}/git/commits',
	updateRef: 'PATCH /repos/{owner}/{repo}/git/refs/{ref}',
};

/** Sample parameters for every placeholder in the table. */
const SAMPLE: Record<string, string> = {
	installation_id: '42',
	owner: 'octo-org',
	repo: 'plans',
	ref: 'heads/main',
	commit_sha: 'c0ffee',
	tree_sha: 'feed',
	file_sha: 'b10b',
};

const names = Object.keys(GITHUB_ENDPOINTS) as GitHubEndpointName[];

function paramsFor(name: GitHubEndpointName): Record<string, string> {
	const keys = [...GITHUB_ENDPOINTS[name].path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '');
	return Object.fromEntries(keys.map((k) => [k, SAMPLE[k] ?? '']));
}

describe('the endpoint table (7.3)', () => {
	it('lists exactly the calls of 7.3, with the OpenAPI paths', () => {
		const listed = Object.fromEntries(
			names.map((n) => [n, `${GITHUB_ENDPOINTS[n].method} ${GITHUB_ENDPOINTS[n].path}`]),
		);
		expect(listed).toEqual(EXPECTED);
	});

	it('creates with 201, reads and moves the branch with 200, and asks for the head conditionally', () => {
		for (const n of names) {
			const e = GITHUB_ENDPOINTS[n];
			expect(e.ok, n).toEqual(e.method === 'POST' ? [201] : [200]);
			expect(e.conditional, n).toBe(n === 'ref');
		}
	});

	it('uses the installation calls with the app and the repository list with a token (18.2)', () => {
		expect(GITHUB_ENDPOINTS.installations.signIn).toBe('app');
		expect(GITHUB_ENDPOINTS.installationRepos.signIn).toBe('app');
		expect(GITHUB_ENDPOINTS.userRepos.signIn).toBe('token');
		const both = names.filter((n) => GITHUB_ENDPOINTS[n].signIn === 'both');
		expect(both).not.toContain('installations');
		expect(both).toContain('updateRef');
	});

	it('talks to api.github.com, with the pinned API version', () => {
		expect(GITHUB_API_ORIGIN).toBe('https://api.github.com');
		expect(GITHUB_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('names the relayed sign-in calls with the GitHub URL each forwards to', () => {
		expect(SIGN_IN_RELAY.deviceCode.github).toBe('https://github.com/login/device/code');
		expect(SIGN_IN_RELAY.accessToken.github).toBe('https://github.com/login/oauth/access_token');
		for (const r of Object.values(SIGN_IN_RELAY)) {
			expect(r.method).toBe('POST');
			expect(r.path.startsWith('/')).toBe(true);
			expect(new URL(r.github).pathname.endsWith(r.path.replace(/^\/github/, ''))).toBe(true);
		}
		expect(DEVICE_VERIFICATION_URL).toBe('https://github.com/login/device');
	});
});

describe('githubUrl', () => {
	it('fills each template', () => {
		expect(githubUrl('user', {})).toBe('https://api.github.com/user');
		expect(githubUrl('ref', { owner: 'o', repo: 'r', ref: branchRef('main') })).toBe(
			'https://api.github.com/repos/o/r/git/ref/heads/main',
		);
		expect(githubUrl('installationRepos', { installation_id: '7' }, { per_page: '100' })).toBe(
			'https://api.github.com/user/installations/7/repositories?per_page=100',
		);
		expect(githubUrl('tree', { owner: 'o', repo: 'r', tree_sha: 'abc' }, { recursive: '1' })).toBe(
			'https://api.github.com/repos/o/r/git/trees/abc?recursive=1',
		);
	});

	it('keeps the slashes of a branch name and encodes each part of it', () => {
		const ref = branchRef('feature/plan #2');
		expect(ref).toBe('heads/feature/plan #2');
		expect(githubUrl('updateRef', { owner: 'o', repo: 'r', ref })).toBe(
			'https://api.github.com/repos/o/r/git/refs/heads/feature/plan%20%232',
		);
		const url = githubUrl('branches', { owner: 'a/b', repo: '/r' });
		expect(url).toBe('https://api.github.com/repos/a%2Fb/%2Fr/branches');
		expect(matchGitHubRequest('GET', url)?.params).toEqual({ owner: 'a/b', repo: '/r' });
	});

	it('refuses an empty parameter, an empty ref segment and a query the endpoint does not take', () => {
		expect(() => githubUrl('commit', { owner: 'o', repo: '', commit_sha: 'c' })).toThrow(/repo/);
		expect(() => githubUrl('ref', { owner: 'o', repo: 'r', ref: 'heads//x' })).toThrow(/ref/);
		const query = { recursive: '1' } as unknown as Partial<Record<EndpointQuery<'blob'>, string>>;
		expect(() => githubUrl('blob', { owner: 'o', repo: 'r', file_sha: 'b' }, query)).toThrow(
			/recursive/,
		);
	});
});

describe('matchGitHubRequest', () => {
	it('is the inverse of githubUrl for every endpoint', () => {
		for (const n of names) {
			const params = paramsFor(n);
			const url = githubUrl(n, params as EndpointParams<typeof n>);
			const m = matchGitHubRequest(GITHUB_ENDPOINTS[n].method, url);
			expect(m?.name, url).toBe(n);
			expect(m?.params).toEqual(params);
		}
	});

	it('decodes parameters, keeps a ref whole and returns the query', () => {
		const ref = branchRef('release/2027 Q1');
		const url = githubUrl('ref', { owner: 'ö', repo: 'r', ref });
		expect(matchGitHubRequest('get', url)).toEqual({
			name: 'ref',
			params: { owner: 'ö', repo: 'r', ref },
			query: {},
		});
		const m = matchGitHubRequest('GET', `${GITHUB_API_ORIGIN}/user/repos?per_page=100&page=2`);
		expect(m).toEqual({ name: 'userRepos', params: {}, query: { per_page: '100', page: '2' } });
	});

	it('tells endpoints that share a path apart by method', () => {
		const trees = `${GITHUB_API_ORIGIN}/repos/o/r/git/trees`;
		expect(matchGitHubRequest('POST', trees)?.name).toBe('createTree');
		expect(matchGitHubRequest('GET', trees)).toBeNull();
		expect(matchGitHubRequest('GET', `${trees}/abc`)?.name).toBe('tree');
	});

	it('refuses other hosts, methods, paths and malformed escapes', () => {
		expect(matchGitHubRequest('GET', 'https://example.com/user')).toBeNull();
		expect(matchGitHubRequest('GET', 'http://api.github.com/user')).toBeNull();
		expect(
			matchGitHubRequest('DELETE', `${GITHUB_API_ORIGIN}/repos/o/r/git/refs/heads/x`),
		).toBeNull();
		expect(
			matchGitHubRequest('GET', `${GITHUB_API_ORIGIN}/repos/o/r/contents/plan.tjp`),
		).toBeNull();
		expect(matchGitHubRequest('GET', `${GITHUB_API_ORIGIN}/repos/o/r/git/ref/heads//x`)).toBeNull();
		expect(matchGitHubRequest('GET', `${GITHUB_API_ORIGIN}/repos/%E0%A4%A/r/branches`)).toBeNull();
		expect(matchGitHubRequest('GET', 'not a url')).toBeNull();
	});
});

describe('parameter types', () => {
	it('derives each endpoint parameters from its template', () => {
		expectTypeOf<PathParams<'/repos/{owner}/{repo}/git/ref/{ref}'>>().toEqualTypeOf<
			'owner' | 'repo' | 'ref'
		>();
		expectTypeOf<EndpointParams<'user'>>().toEqualTypeOf<Readonly<Record<never, string>>>();
		expectTypeOf<EndpointParams<'blob'>>().toEqualTypeOf<
			Readonly<Record<'owner' | 'repo' | 'file_sha', string>>
		>();
		expectTypeOf<EndpointQuery<'tree'>>().toEqualTypeOf<'recursive'>();
		expectTypeOf<EndpointQuery<'branches'>>().toEqualTypeOf<'per_page' | 'page'>();
		// @ts-expect-error: `commit` needs `commit_sha`.
		expect(() => githubUrl('commit', { owner: 'o', repo: 'r' })).toThrow();
	});
});
