// SPDX-License-Identifier: GPL-2.0-or-later
// Provider contract (phase-4.md 6.1): the error constructors, the limits and the guards, and
// compile checks of the interface (`npm run typecheck` enforces them). Providers' tests come with
// T5 and T8.
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	isPlanFile,
	isStorageFailure,
	isWorkspaceId,
	PLAN_LIMITS,
	planLimitProblem,
	StorageFailure,
	storageError,
	type Access,
	type FolderLocation,
	type GitHubLocation,
	type Location,
	type ProviderLocation,
	type RemoteSnapshot,
	type StorageError,
	type StorageErrorKind,
	type StorageProvider,
	type WriteRequest,
	type WriteResult,
} from './types';

const MIB = 1024 * 1024;

describe('storage errors (6.1)', () => {
	it('builds an error with no retry by default', () => {
		expect(storageError('offline', 'fetch failed')).toEqual({
			kind: 'offline',
			retryAfterMs: null,
			detail: 'fetch failed',
		});
		expect(storageError('rate-limited', '429', 60_000).retryAfterMs).toBe(60_000);
	});

	it('carries the error in a StorageFailure, which the guard tells from other errors', () => {
		const e = new StorageFailure(storageError('not-found', 'branch main'));
		expect(e).toBeInstanceOf(Error);
		expect(e.name).toBe('StorageFailure');
		expect(e.message).toBe('not-found: branch main');
		expect(e.error.kind).toBe('not-found');
		expect(isStorageFailure(e)).toBe(true);
		expect(isStorageFailure(new Error('x'))).toBe(false);
		expect(isStorageFailure(storageError('server', 'plain object'))).toBe(false);
		expect(isStorageFailure(new DOMException('aborted', 'AbortError'))).toBe(false);
	});

	it('names the nine kinds of 6.1', () => {
		expectTypeOf<StorageErrorKind>().toEqualTypeOf<
			| 'offline'
			| 'auth'
			| 'permission'
			| 'not-found'
			| 'quota'
			| 'rate-limited'
			| 'too-large'
			| 'unsupported'
			| 'server'
		>();
		expectTypeOf<StorageError>().toEqualTypeOf<{
			readonly kind: StorageErrorKind;
			readonly retryAfterMs: number | null;
			readonly detail: string;
		}>();
	});
});

describe('plan limits (6.1)', () => {
	it('allows 200 files, 2 MiB per file and 8 MiB in all', () => {
		expect(PLAN_LIMITS).toEqual({ files: 200, fileBytes: 2 * MIB, totalBytes: 8 * MIB });
		expect(Object.isFrozen(PLAN_LIMITS)).toBe(true);
	});

	it('is within the limits up to each one, inclusive', () => {
		expect(planLimitProblem([])).toBeNull();
		expect(planLimitProblem(new Array<number>(200).fill(1))).toBeNull();
		expect(planLimitProblem([2 * MIB])).toBeNull();
		expect(planLimitProblem([2 * MIB, 2 * MIB, 2 * MIB, 2 * MIB])).toBeNull();
	});

	it('names the limit passed: the file count first, then one file, then the total', () => {
		expect(planLimitProblem(new Array<number>(201).fill(1))).toBe('files');
		expect(planLimitProblem(new Array<number>(201).fill(3 * MIB))).toBe('files');
		expect(planLimitProblem([2 * MIB + 1])).toBe('file');
		expect(planLimitProblem([10 * MIB])).toBe('file');
		expect(planLimitProblem([2 * MIB, 2 * MIB, 2 * MIB, 2 * MIB, 1])).toBe('total');
	});

	it('takes any iterable of sizes, such as a map of sizes', () => {
		const sizes = new Map([
			['plan.tjp', 3 * MIB],
			['lib/a.tji', 10],
		]);
		expect(planLimitProblem(sizes.values())).toBe('file');
	});
});

describe('plan files and ids', () => {
	it('reads and writes .tjp and .tji files only (7.4)', () => {
		expect(isPlanFile('plan.tjp')).toBe(true);
		expect(isPlanFile('lib/tasks.tji')).toBe(true);
		expect(isPlanFile('README.md')).toBe(false);
		expect(isPlanFile('plan.tjp.bak')).toBe(false);
		expect(isPlanFile('plan.TJP')).toBe(false);
	});

	it('accepts a random UUID as a workspace id, and nothing that is unsafe in a key or URL', () => {
		expect(isWorkspaceId(crypto.randomUUID())).toBe(true);
		expect(isWorkspaceId('abc_DEF-123')).toBe(true);
		for (const bad of ['', 'a b', 'a/b', 'a:b', 'ws:1', 'x'.repeat(65), 'é', null, 7]) {
			expect(isWorkspaceId(bad)).toBe(false);
		}
	});
});

describe('locations and providers (6.1)', () => {
	it('has the three locations, with providers for folders and GitHub only', () => {
		expectTypeOf<Location['kind']>().toEqualTypeOf<'browser' | 'folder' | 'github'>();
		expectTypeOf<ProviderLocation>().toEqualTypeOf<FolderLocation | GitHubLocation>();
		expectTypeOf<FolderLocation>().toEqualTypeOf<{
			readonly kind: 'folder';
			readonly handle: string;
			readonly name: string;
		}>();
		expectTypeOf<GitHubLocation>().toEqualTypeOf<{
			readonly kind: 'github';
			readonly account: string;
			readonly owner: string;
			readonly repo: string;
			readonly branch: string;
			readonly dir: string;
		}>();
		expectTypeOf<Access>().toEqualTypeOf<'granted' | 'prompt' | 'signed-out' | 'denied'>();
	});

	it('deals in bytes at the boundary', () => {
		expectTypeOf<RemoteSnapshot['files']>().toEqualTypeOf<ReadonlyMap<string, Uint8Array>>();
		expectTypeOf<WriteRequest['files']>().toEqualTypeOf<ReadonlyMap<string, Uint8Array>>();
		expectTypeOf<RemoteSnapshot['author']>().toEqualTypeOf<string | null>();
		expectTypeOf<WriteRequest['parents']>().toEqualTypeOf<readonly string[] | undefined>();
	});

	it('writes added files like changed ones, and has no way to delete or rename (21)', () => {
		const req: WriteRequest = {
			base: 'c0ffee',
			files: new Map([['parts/people.tji', new TextEncoder().encode('resource dev "Dev"\n')]]),
			message: 'Plan: add parts/people.tji',
		};
		expect([...req.files.keys()]).toEqual(['parts/people.tji']);
		expectTypeOf<keyof WriteRequest>().toEqualTypeOf<'base' | 'files' | 'message' | 'parents'>();
		expectTypeOf<keyof StorageProvider<FolderLocation>>().toEqualTypeOf<
			'kind' | 'access' | 'requestAccess' | 'head' | 'read' | 'write'
		>();
	});

	it('resolves a write as written, moved or failed', () => {
		expectTypeOf<WriteResult['status']>().toEqualTypeOf<'written' | 'moved' | 'failed'>();
		expectTypeOf<Extract<WriteResult, { status: 'moved' }>>().toEqualTypeOf<{
			readonly status: 'moved';
			readonly head: string;
			readonly commit: string | null;
		}>();
		expectTypeOf<
			Extract<WriteResult, { status: 'failed' }>['error']
		>().toEqualTypeOf<StorageError>();
	});

	it('fixes the provider methods', () => {
		type P = StorageProvider<GitHubLocation>;
		expectTypeOf<P['kind']>().toEqualTypeOf<'github'>();
		expectTypeOf<StorageProvider<FolderLocation>['kind']>().toEqualTypeOf<'folder'>();
		expectTypeOf<P['access']>().toEqualTypeOf<(loc: GitHubLocation) => Promise<Access>>();
		expectTypeOf<P['requestAccess']>().toEqualTypeOf<(loc: GitHubLocation) => Promise<Access>>();
		expectTypeOf<P['head']>().toEqualTypeOf<
			(loc: GitHubLocation, signal?: AbortSignal) => Promise<string | null>
		>();
		expectTypeOf<P['read']>().toEqualTypeOf<
			(loc: GitHubLocation, signal?: AbortSignal) => Promise<RemoteSnapshot>
		>();
		expectTypeOf<P['write']>().toEqualTypeOf<
			(loc: GitHubLocation, req: WriteRequest, signal?: AbortSignal) => Promise<WriteResult>
		>();
		// A browser-only plan has no provider.
		// @ts-expect-error: StorageProvider takes a folder or GitHub location.
		expectTypeOf<StorageProvider<{ kind: 'browser' }>>().not.toBeNever();
	});
});
