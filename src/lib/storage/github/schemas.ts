// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The bodies of the GitHub calls in endpoints.ts (phase-4.md 7.3, 13.3): what the provider (T8)
 * sends and the fields it reads, a subset of GitHub's schemas. The fake (T9) may answer with more
 * fields; the drift test checks its full responses against GitHub's OpenAPI description. Types
 * only.
 *
 * Contract notes (T3): `updateRef`'s body types `force` as `false`, so no forced update can be
 * written (8.1 #4); `createTree` entries are blobs only and never delete (8.1 #5); blob content
 * is base64 both ways (endpoints.ts, bytes). `GitHubIo` has one entry per endpoint of
 * `GITHUB_ENDPOINTS` (schemas.test.ts checks the keys).
 */

export interface GitHubUser {
	readonly id: number;
	readonly login: string;
}
export interface GitHubInstallation {
	readonly id: number;
	readonly account: { readonly login: string } | null;
	readonly repository_selection: 'all' | 'selected';
	readonly permissions: Readonly<Record<string, string>>;
}
export interface GitHubRepository {
	readonly id: number;
	readonly name: string;
	readonly full_name: string;
	readonly owner: { readonly login: string };
	readonly private: boolean;
	readonly default_branch: string;
	readonly permissions?: { readonly pull: boolean; readonly push: boolean };
}
export interface GitHubBranch {
	readonly name: string;
	readonly commit: { readonly sha: string };
}
export interface GitRef {
	readonly ref: string;
	readonly object: { readonly type: string; readonly sha: string };
}
export interface GitCommit {
	readonly sha: string;
	readonly message: string;
	readonly tree: { readonly sha: string };
	readonly parents: readonly { readonly sha: string }[];
	/** `date` is ISO 8601. */
	readonly author: { readonly name: string; readonly email: string; readonly date: string };
}
export interface GitTreeEntry {
	readonly path: string;
	readonly mode: string;
	readonly type: 'blob' | 'tree' | 'commit';
	readonly sha: string;
	readonly size?: number;
}
export interface GitTree {
	readonly sha: string;
	readonly truncated: boolean;
	readonly tree: readonly GitTreeEntry[];
}
export interface GitBlob {
	readonly sha: string;
	readonly size: number;
	readonly encoding: 'base64';
	/** Base64, possibly with line breaks. */
	readonly content: string;
}
/** A `createTree` entry: a blob at a path under the root of the repository. */
export interface GitTreeWrite {
	readonly path: string;
	/** The file's mode in the base tree; `100644` for a new file. */
	readonly mode: '100644' | '100755';
	readonly type: 'blob';
	readonly sha: string;
}

/** Request bodies and responses per endpoint (`body: null` for a GET). */
export interface GitHubIo {
	user: { body: null; response: GitHubUser };
	installations: {
		body: null;
		response: {
			readonly total_count: number;
			readonly installations: readonly GitHubInstallation[];
		};
	};
	installationRepos: {
		body: null;
		response: { readonly total_count: number; readonly repositories: readonly GitHubRepository[] };
	};
	userRepos: { body: null; response: readonly GitHubRepository[] };
	branches: { body: null; response: readonly GitHubBranch[] };
	ref: { body: null; response: GitRef };
	commit: { body: null; response: GitCommit };
	tree: { body: null; response: GitTree };
	blob: { body: null; response: GitBlob };
	createBlob: {
		body: { readonly content: string; readonly encoding: 'base64' };
		response: { readonly sha: string };
	};
	createTree: {
		body: { readonly base_tree: string; readonly tree: readonly GitTreeWrite[] };
		response: { readonly sha: string };
	};
	createCommit: {
		body: { readonly message: string; readonly tree: string; readonly parents: readonly string[] };
		response: GitCommit;
	};
	updateRef: { body: { readonly sha: string; readonly force: false }; response: GitRef };
}

export type GitHubBody<N extends keyof GitHubIo> = GitHubIo[N]['body'];
export type GitHubResponse<N extends keyof GitHubIo> = GitHubIo[N]['response'];

// The device flow through the sign-in relay (endpoints.ts `SIGN_IN_RELAY`).

export interface DeviceCodeRequest {
	readonly client_id: string;
}
export interface DeviceCodeResponse {
	readonly device_code: string;
	readonly user_code: string;
	readonly verification_uri: string;
	/** Seconds. */
	readonly expires_in: number;
	/** Seconds between polls; `slow_down` adds 5. */
	readonly interval: number;
}
/** The device-code exchange (no secret), or a refresh (the worker adds the client secret). */
export type AccessTokenRequest =
	| {
			readonly client_id: string;
			readonly device_code: string;
			readonly grant_type: 'urn:ietf:params:oauth:grant-type:device_code';
	  }
	| {
			readonly client_id: string;
			readonly refresh_token: string;
			readonly grant_type: 'refresh_token';
	  };
export type AccessTokenError =
	| 'authorization_pending'
	| 'slow_down'
	| 'expired_token'
	| 'access_denied'
	| 'incorrect_device_code'
	| 'bad_refresh_token'
	| 'unsupported_grant_type'
	| 'incorrect_client_credentials'
	| 'device_flow_disabled';
export type AccessTokenResponse =
	| {
			readonly access_token: string;
			readonly token_type: 'bearer';
			/** Seconds; app tokens last 8 h. */
			readonly expires_in?: number;
			readonly refresh_token?: string;
			readonly refresh_token_expires_in?: number;
	  }
	| {
			readonly error: AccessTokenError;
			readonly error_description?: string;
			/** With `slow_down`: the new interval, seconds. */
			readonly interval?: number;
	  };
