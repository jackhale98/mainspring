// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Every GitHub call Mainspring makes (phase-4.md 7.3, 10.1, 13.3; ADR-0019 #2, #3): the REST
 * endpoints on `api.github.com` and the two sign-in calls the worker relays. The GitHub provider
 * (T8: `api.ts`, `auth.ts`) builds its requests from this table, and the fake GitHub (T9:
 * `tests/fakes/github/`) answers exactly these, so neither is written against a guess. The drift
 * test (13.3) checks the fake's responses against GitHub's OpenAPI description at `path`. The
 * request and response bodies are in schemas.ts (`GitHubIo`, one entry per endpoint here).
 *
 * ## Contract
 *
 * - **Hosts** (10.1). REST calls go to `GITHUB_API_ORIGIN` with `Authorization: Bearer <token>`,
 *   `Accept: GITHUB_ACCEPT` and `X-GitHub-Api-Version: GITHUB_API_VERSION`, through net.ts on the
 *   main thread (so Playwright can route them). The sign-in calls go to the configured worker
 *   origin and never carry a token of ours. net.ts refuses every other host.
 * - **Bytes** (ADR-0003). Blobs are read and written base64 (`encoding: 'base64'`), decoded to and
 *   from bytes, never through text, so a file's bytes round-trip exactly. A blob with another
 *   encoding is a `server` error.
 * - **Only `dir`** (7.3, 7.4). The provider walks the commit's tree to `dir` one level at a time
 *   (`tree` without `recursive`), then lists `dir`'s own tree with `recursive=1`; a listing with
 *   `truncated: true` is `too-large`. Only `blob` entries that are plan files are read.
 * - **Commit** (7.3). `createBlob` per changed file, `createTree` with `base_tree` (the base
 *   commit's tree: every other file is kept; a file keeps its mode, a new one is `100644`),
 *   `createCommit` with `WriteRequest.parents` (default `[base]`), then `updateRef` with
 *   `force: false` (the type allows nothing else). Nothing is ever deleted.
 * - **Conditional head.** `ref` is sent with `If-None-Match` from the last ETag the provider holds
 *   for that branch; a 304 means the head it holds, and does not count against the rate limit.
 * - **Statuses** (types.ts `StorageError`):
 *
 *   | Status | Meaning |
 *   | --- | --- |
 *   | `ok` | the response body is the endpoint's `response` |
 *   | 304 (`ref`) | unchanged: the head the provider holds |
 *   | 401 | the token expired or was revoked: an app token is refreshed once, then `auth` |
 *   | 403 or 429 with `retry-after` or `x-ratelimit-remaining: 0` | `rate-limited` |
 *   | 403 otherwise | `permission` |
 *   | 404 | `not-found` (also a private repository the account cannot see) |
 *   | 422 (`updateRef`) | `moved` when `ref` then differs from the base; otherwise `server` |
 *   | other, 5xx | `server` |
 *   | fetch `TypeError` | `offline` |
 *
 * Contract notes (T3):
 * - `branches` is added to 7.3's list: Open from GitHub lets the user pick the branch, with the
 *   default preselected (11.1), and 7.3 lists no call that lists branches. The repository's
 *   `default_branch` comes from the repository lists.
 * - The sign-in relay's paths (`SIGN_IN_RELAY`) are T3's proposal: the worker forwards each to
 *   the GitHub URL named beside it and adds the client secret to a refresh only. T10 sets up the
 *   worker; if its routes differ, this table is the one place to change.
 * - Pagination: list endpoints take `per_page` (at most 100) and `page`; the provider asks for the
 *   next page while a page is full.
 */

export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';
export const GITHUB_ACCEPT = 'application/vnd.github+json';

export type GitHubMethod = 'GET' | 'POST' | 'PATCH';

export interface GitHubEndpoint {
	readonly method: GitHubMethod;
	/**
	 * The path template as GitHub's OpenAPI description names it. A `{name}` stands for one
	 * segment; `{ref}` for one or more (`heads/feature/x`), each encoded on its own.
	 */
	readonly path: string;
	/** The statuses that carry the endpoint's `response`. */
	readonly ok: readonly number[];
	/** The query parameters the provider may send; `githubUrl` refuses others. */
	readonly query: readonly string[];
	/** Sent with `If-None-Match` (module comment). */
	readonly conditional: boolean;
	/** Used with the GitHub App's sign-in, a pasted token, or both (18.2). */
	readonly signIn: 'app' | 'token' | 'both';
}

const LIST = ['per_page', 'page'] as const;

/** 7.3's endpoints (plus `branches`, contract notes). */
export const GITHUB_ENDPOINTS = {
	/** Who is signed in. */
	user: { method: 'GET', path: '/user', ok: [200], query: [], conditional: false, signIn: 'both' },
	/** The app's installations the user can reach (one per account that installed it). */
	installations: {
		method: 'GET',
		path: '/user/installations',
		ok: [200],
		query: LIST,
		conditional: false,
		signIn: 'app',
	},
	/** The repositories of one installation. */
	installationRepos: {
		method: 'GET',
		path: '/user/installations/{installation_id}/repositories',
		ok: [200],
		query: LIST,
		conditional: false,
		signIn: 'app',
	},
	/** With a token: the repositories it can reach. */
	userRepos: {
		method: 'GET',
		path: '/user/repos',
		ok: [200],
		query: LIST,
		conditional: false,
		signIn: 'token',
	},
	branches: {
		method: 'GET',
		path: '/repos/{owner}/{repo}/branches',
		ok: [200],
		query: LIST,
		conditional: false,
		signIn: 'both',
	},
	/** The head of a branch: `ref` is `heads/<branch>` (`branchRef`). */
	ref: {
		method: 'GET',
		path: '/repos/{owner}/{repo}/git/ref/{ref}',
		ok: [200],
		query: [],
		conditional: true,
		signIn: 'both',
	},
	commit: {
		method: 'GET',
		path: '/repos/{owner}/{repo}/git/commits/{commit_sha}',
		ok: [200],
		query: [],
		conditional: false,
		signIn: 'both',
	},
	tree: {
		method: 'GET',
		path: '/repos/{owner}/{repo}/git/trees/{tree_sha}',
		ok: [200],
		query: ['recursive'],
		conditional: false,
		signIn: 'both',
	},
	blob: {
		method: 'GET',
		path: '/repos/{owner}/{repo}/git/blobs/{file_sha}',
		ok: [200],
		query: [],
		conditional: false,
		signIn: 'both',
	},
	createBlob: {
		method: 'POST',
		path: '/repos/{owner}/{repo}/git/blobs',
		ok: [201],
		query: [],
		conditional: false,
		signIn: 'both',
	},
	createTree: {
		method: 'POST',
		path: '/repos/{owner}/{repo}/git/trees',
		ok: [201],
		query: [],
		conditional: false,
		signIn: 'both',
	},
	createCommit: {
		method: 'POST',
		path: '/repos/{owner}/{repo}/git/commits',
		ok: [201],
		query: [],
		conditional: false,
		signIn: 'both',
	},
	/** Moves a branch: `ref` is `heads/<branch>`; never forced. */
	updateRef: {
		method: 'PATCH',
		path: '/repos/{owner}/{repo}/git/refs/{ref}',
		ok: [200],
		query: [],
		conditional: false,
		signIn: 'both',
	},
} as const satisfies Readonly<Record<string, GitHubEndpoint>>;

export type GitHubEndpointName = keyof typeof GITHUB_ENDPOINTS;

/** The `{name}`s of a path template. */
export type PathParams<P extends string> = P extends `${string}{${infer K}}${infer Rest}`
	? K | PathParams<Rest>
	: never;
export type EndpointParams<N extends GitHubEndpointName> = Readonly<
	Record<PathParams<(typeof GITHUB_ENDPOINTS)[N]['path']>, string>
>;
export type EndpointQuery<N extends GitHubEndpointName> =
	(typeof GITHUB_ENDPOINTS)[N]['query'][number];

/** The `ref` of a branch, for `ref` and `updateRef`. */
export function branchRef(branch: string): string {
	return `heads/${branch}`;
}

/** `{ref}` keeps its '/' between segments; every other parameter is one encoded segment. */
function encodeParam(key: string, value: string): string {
	if (key !== 'ref') return encodeURIComponent(value);
	const parts = value.split('/');
	if (parts.some((p) => p === '')) throw new Error(`githubUrl: bad ref ${JSON.stringify(value)}`);
	return parts.map(encodeURIComponent).join('/');
}

/**
 * The URL of one endpoint. Throws on an empty parameter or a query name the endpoint does not
 * list (a bug, never the user's input).
 */
export function githubUrl<N extends GitHubEndpointName>(
	name: N,
	params: EndpointParams<N>,
	query: Partial<Readonly<Record<EndpointQuery<N>, string>>> = {},
): string {
	const e: GitHubEndpoint = GITHUB_ENDPOINTS[name];
	const values: Readonly<Record<string, string | undefined>> = params;
	const path = e.path.replace(/\{(\w+)\}/g, (_m, key: string) => {
		const v = values[key];
		if (v === undefined || v === '') throw new Error(`githubUrl ${name}: no ${key}`);
		return encodeParam(key, v);
	});
	const search = new URLSearchParams();
	for (const [k, v] of Object.entries<string | undefined>(query)) {
		if (!e.query.includes(k)) throw new Error(`githubUrl ${name}: no query ${k}`);
		if (v !== undefined) search.set(k, v);
	}
	const s = search.toString();
	return `${GITHUB_API_ORIGIN}${path}${s ? `?${s}` : ''}`;
}

/** A request `matchGitHubRequest` recognised, narrowed by `name`. */
export type GitHubRequestMatch = {
	[N in GitHubEndpointName]: {
		readonly name: N;
		readonly params: EndpointParams<N>;
		readonly query: Readonly<Record<string, string>>;
	};
}[GitHubEndpointName];

interface Pattern {
	readonly name: GitHubEndpointName;
	readonly method: GitHubMethod;
	readonly keys: readonly string[];
	readonly re: RegExp;
}

let patterns: readonly Pattern[] | null = null;

function compile(): readonly Pattern[] {
	return (Object.keys(GITHUB_ENDPOINTS) as GitHubEndpointName[]).map((name) => {
		const e: GitHubEndpoint = GITHUB_ENDPOINTS[name];
		const keys: string[] = [];
		const source = e.path.replace(/\{(\w+)\}/g, (_m, key: string) => {
			keys.push(key);
			return key === 'ref' ? '([^?#]+)' : '([^/?#]+)';
		});
		return { name, method: e.method, keys, re: new RegExp(`^${source}$`) };
	});
}

function decodeParam(key: string, raw: string): string {
	return key === 'ref' ? raw.split('/').map(decodeURIComponent).join('/') : decodeURIComponent(raw);
}

/**
 * Which endpoint a request is, with its decoded parameters and every query parameter it carries;
 * null for any other request (another host, method or path, or a malformed escape). The inverse
 * of `githubUrl`: the fake routes with it.
 */
export function matchGitHubRequest(method: string, url: string): GitHubRequestMatch | null {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return null;
	}
	if (u.origin !== GITHUB_API_ORIGIN) return null;
	patterns ??= compile();
	for (const p of patterns) {
		if (p.method !== method.toUpperCase()) continue;
		const m = p.re.exec(u.pathname);
		if (!m) continue;
		const params: Record<string, string> = {};
		try {
			p.keys.forEach((k, i) => (params[k] = decodeParam(k, m[i + 1] ?? '')));
		} catch {
			return null;
		}
		if (params['ref']?.split('/').includes('')) return null;
		const query = Object.fromEntries(u.searchParams);
		return { name: p.name, params, query } as GitHubRequestMatch;
	}
	return null;
}

/**
 * The sign-in calls the worker relays (7.3 option B, ADR-0019 #2), by path on the worker origin,
 * each with the GitHub URL it forwards to. Both are `POST` with a JSON body and
 * `Accept: application/json`, and GitHub answers 200 with either a result or `{ error }`.
 */
export const SIGN_IN_RELAY = {
	deviceCode: {
		method: 'POST',
		path: '/github/login/device/code',
		github: 'https://github.com/login/device/code',
	},
	accessToken: {
		method: 'POST',
		path: '/github/login/oauth/access_token',
		github: 'https://github.com/login/oauth/access_token',
	},
} as const;

/** Where the user enters the device code (opened in a new tab, never fetched). */
export const DEVICE_VERIFICATION_URL = 'https://github.com/login/device';
