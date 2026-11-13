// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The engine runtime (phase-0 spec 3.2), ported from poc/web/tj-runtime.mjs: loads and verifies
 * the hashed assets, boots CRuby (ruby.wasm) on browser_wasi_shim with the bundle mounted at
 * `/tj` and a writable `/workspace`, defines `globalThis.tjTz` for the bridge's time-zone patch,
 * and requires the bridge. Then it runs one request at a time, synchronously.
 *
 * Runs in the worker (worker.ts) and in Node (engine/golden/run-wasm.mjs, unit tests). Relative
 * imports name their `.ts` file so Node's type stripping can load this module directly.
 *
 * Errors are `EngineFailure`s (failure.ts): `boot` while starting; `invalid-request`, `internal`
 * or `crash` as the bridge reports them; `crash` when the VM fails underneath (wasm trap, out of
 * memory, Ruby VM bug), after which every further call fails with `crash` too.
 *
 * `bootEngineForNode` boots the same engine typed as `NodeEngine`, which adds the phase-1 token
 * oracle `tokens(text)` (spec 6.9). Only Node tools use it; the worker boots with `bootEngine`,
 * whose `Engine` type has no `tokens`, and the worker protocol has no message for it.
 */
import { WASI } from '@bjorn3/browser_wasi_shim';
import { RbError, RbFatalError, RubyVM, type RbValue } from '@ruby/wasm-wasi';
import { EngineFailure, isFatalWasmError } from './failure.ts';
import { decodeText, loadAsset, loadManifest, type AssetLoader } from './manifest.ts';
import type { EngineVersions, ScheduleRequest, ScheduleResult, SyntaxDocs, Timings } from './protocol';
import type { TokenOracleResult } from './token-oracle';
import { BUNDLE_ROOT, WORKSPACE_ROOT, clearDirectory, createEngineFs, type LogFn } from './wasi-fs.ts';

export interface BootTimings {
	/** manifest.json fetched and checked. */
	manifestMs: number;
	/** Both assets fetched, gunzipped and verified (in parallel). */
	assetsMs: number;
	compileMs: number;
	/** WASI set-up and Ruby VM start. */
	instantiateMs: number;
	/** TaskJuggler and the bridge required. */
	requireMs: number;
	totalMs: number;
}

export interface Engine {
	readonly versions: EngineVersions;
	/** RUBY_VERSION inside the VM. */
	readonly rubyVersion: string;
	/** From the start of `bootEngine` to the bridge being loaded. */
	readonly bootMs: number;
	readonly bootTimings: BootTimings;
	/** Never throws for TaskJuggler errors (they are messages); see the module comment. */
	schedule(request: ScheduleRequest): ScheduleResult;
	syntax(): SyntaxDocs;
}

/** The engine as Node tools see it: `Engine` plus the token oracle, which the worker never exposes. */
export interface NodeEngine extends Engine {
	/**
	 * TaskJuggler's own scanner over `text`, without macro expansion: every token and trivia item
	 * with UTF-16 offsets (token-oracle.ts). Scanner errors are part of the result; bridge failures
	 * throw `EngineFailure` like `schedule`. It reads and changes no workspace state.
	 */
	tokens(text: string): TokenOracleResult;
}

export interface BootOptions {
	/** Reads a file next to manifest.json. */
	load: AssetLoader;
	/** Ruby's stdout and stderr. Default: dropped. */
	log?: LogFn;
	/** Clock in ms. Default: `performance.now`. */
	now?: () => number;
}

export { createTimeZoneHost, type TimeZoneHost } from './timezone.ts';
import { createTimeZoneHost } from './timezone.ts';

/** Defines `globalThis.tjTz` (once per realm). */
export function installTimeZoneHost(target: object = globalThis): void {
	Object.defineProperty(target, 'tjTz', {
		value: createTimeZoneHost(),
		configurable: true,
		writable: true,
	});
}

const round1 = (ms: number): number => Math.round(ms * 10) / 10;
const BRIDGE_ERROR_KINDS = new Set(['invalid-request', 'internal', 'crash'] as const);
type BridgeErrorKind = 'invalid-request' | 'internal' | 'crash';

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parses bridge JSON; `{ error }` replies become `EngineFailure`s. */
export function parseBridgeReply(json: string): Record<string, unknown> {
	let reply: unknown;
	try {
		reply = JSON.parse(json);
	} catch (error) {
		throw new EngineFailure('internal', 'The engine bridge returned invalid JSON.', String(error));
	}
	if (!isRecord(reply)) throw new EngineFailure('internal', 'The engine bridge reply is not an object.');
	const error = reply['error'];
	if (error === undefined) return reply;
	const e = isRecord(error) ? error : {};
	const kind = BRIDGE_ERROR_KINDS.has(e['kind'] as BridgeErrorKind)
		? (e['kind'] as BridgeErrorKind)
		: 'internal';
	const message = typeof e['message'] === 'string' ? e['message'] : 'The engine bridge failed.';
	const detail = typeof e['detail'] === 'string' ? e['detail'] : undefined;
	throw new EngineFailure(kind, message, detail);
}

/** The fast-path fields of the bridge's timings (protocol.ts `Timings`), when present. */
function fastTimings(t: Record<string, unknown>): Partial<Timings> {
	const out: Partial<Timings> = {};
	if (t['path'] === 'full' || t['path'] === 'fast') out.path = t['path'];
	for (const k of ['retainMs', 'retainBytes', 'cloneMs', 'applyMs'] as const) {
		if (typeof t[k] === 'number') out[k] = t[k];
	}
	if (typeof t['fastFallback'] === 'string') out.fastFallback = t['fastFallback'];
	if (typeof t['retainError'] === 'string') out.retainError = t['retainError'];
	return out;
}

/** True for Ruby errors that mean the VM itself is broken (see wrapRbOperation in ruby.wasm). */
function isVmBroken(error: unknown): boolean {
	if (error instanceof RbFatalError || isFatalWasmError(error)) return true;
	if (!(error instanceof RbError)) return true; // a JS error inside a Ruby call: state unknown
	return /^Something went wrong in Ruby VM|\((?:NoMemoryError|SystemStackError|fatal)\)/m.test(
		error.message,
	);
}

class WasmEngine implements NodeEngine {
	readonly versions: EngineVersions;
	readonly rubyVersion: string;
	readonly bootMs: number;
	readonly bootTimings: BootTimings;
	readonly #vm: RubyVM;
	readonly #bridge: RbValue;
	readonly #clearWorkspace: () => void;
	readonly #now: () => number;
	#broken: string | null = null;
	#syntax: SyntaxDocs | null = null;

	constructor(init: {
		vm: RubyVM;
		versions: EngineVersions;
		rubyVersion: string;
		timings: BootTimings;
		clearWorkspace: () => void;
		now: () => number;
	}) {
		this.#vm = init.vm;
		this.#bridge = init.vm.eval('TJBridge');
		this.versions = init.versions;
		this.rubyVersion = init.rubyVersion;
		this.bootTimings = init.timings;
		this.bootMs = init.timings.totalMs;
		this.#clearWorkspace = init.clearWorkspace;
		this.#now = init.now;
	}

	schedule(request: ScheduleRequest): ScheduleResult {
		const t0 = this.#now();
		let json: string;
		try {
			json = JSON.stringify({
				files: request.files,
				entry: request.entry,
				revision: request.revision,
				options: request.options ?? {},
				...(request.retain ? { retain: true } : {}),
				...(request.fast ? { fast: request.fast } : {}),
			});
		} catch (error) {
			throw new EngineFailure('invalid-request', 'The request cannot be encoded.', String(error));
		}
		const t1 = this.#now();
		const reply = this.#reply(
			this.#call(() => {
				this.#clearWorkspace();
				return this.#bridge.call('schedule', this.#vm.wrap(json)).toString();
			}),
		);
		const timings = isRecord(reply['timings']) ? reply['timings'] : {};
		const ms = (name: string): number =>
			typeof timings[name] === 'number' ? (timings[name] as number) : 0;
		const result = reply as unknown as ScheduleResult;
		result.revision = request.revision;
		result.timings = {
			writeFsMs: round1(t1 - t0 + ms('writeFsMs')),
			parseMs: ms('parseMs'),
			scheduleMs: ms('scheduleMs'),
			serializeMs: ms('serializeMs'),
			totalMs: round1(this.#now() - t0),
			...fastTimings(timings),
		};
		return result;
	}

	syntax(): SyntaxDocs {
		if (!this.#syntax) {
			const reply = this.#reply(this.#call(() => this.#bridge.call('syntax').toString()));
			this.#syntax = reply as unknown as SyntaxDocs;
		}
		return this.#syntax;
	}

	tokens(text: string): TokenOracleResult {
		const reply = this.#reply(
			this.#call(() => this.#bridge.call('tokens', this.#vm.wrap(text)).toString()),
		);
		return reply as unknown as TokenOracleResult;
	}

	/** parseBridgeReply; a `crash` the bridge reports (out of memory) also breaks the engine. */
	#reply(json: string): Record<string, unknown> {
		try {
			return parseBridgeReply(json);
		} catch (error) {
			if (error instanceof EngineFailure && error.kind === 'crash') {
				this.#broken = error.detail ?? error.message;
			}
			throw error;
		}
	}

	/** Runs a Ruby call; marks the engine broken when the VM fails underneath. */
	#call(fn: () => string): string {
		if (this.#broken !== null) {
			throw new EngineFailure('crash', 'The engine stopped after an earlier failure.', this.#broken);
		}
		try {
			return fn();
		} catch (error) {
			const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
			if (isVmBroken(error)) {
				this.#broken = detail;
				throw new EngineFailure('crash', 'The engine stopped unexpectedly.', detail);
			}
			throw new EngineFailure('internal', 'The engine raised an error.', detail);
		}
	}
}

/** Loads, verifies and boots the engine. Throws `EngineFailure` (kind `boot`). */
export async function bootEngine(opts: BootOptions): Promise<Engine> {
	return boot(opts);
}

/** `bootEngine` for Node tools (engine/golden/run-wasm.mjs): the same engine, with `tokens()`. */
export async function bootEngineForNode(opts: BootOptions): Promise<NodeEngine> {
	return boot(opts);
}

async function boot(opts: BootOptions): Promise<WasmEngine> {
	const now = opts.now ?? (() => performance.now());
	const log = opts.log ?? (() => {});
	const t0 = now();
	const manifest = await loadManifest(opts.load);
	const t1 = now();
	const [rubyBytes, bundleBytes] = await Promise.all([
		loadAsset(opts.load, manifest.ruby),
		loadAsset(opts.load, manifest.bundle),
	]);
	const t2 = now();
	try {
		const module = await WebAssembly.compile(rubyBytes as Uint8Array<ArrayBuffer>);
		const t3 = now();
		const files = parseBundle(decodeText(bundleBytes));
		const fs = createEngineFs(files, log);
		const wasi = new WASI([], ['LANG=C.UTF-8', `HOME=${WORKSPACE_ROOT}`], fs.fds, { debug: false });
		const { vm } = await RubyVM.instantiateModule({ module, wasip1: wasi });
		installTimeZoneHost();
		const t4 = now();
		const lib = ['lib', 'stubs', 'bridge'].map((d) => JSON.stringify(`${BUNDLE_ROOT}/${d}`));
		vm.eval(`$LOAD_PATH.unshift(${lib.join(', ')}); require "tj_bridge"`);
		const ruby = JSON.parse(vm.eval('TJBridge.versions').toString()) as { tj: string; ruby: string };
		if (ruby.tj !== manifest.tj.version) {
			throw new EngineFailure('boot', `The engine bundle holds TaskJuggler ${ruby.tj}.`);
		}
		const t5 = now();
		const timings: BootTimings = {
			manifestMs: round1(t1 - t0),
			assetsMs: round1(t2 - t1),
			compileMs: round1(t3 - t2),
			instantiateMs: round1(t4 - t3),
			requireMs: round1(t5 - t4),
			totalMs: round1(t5 - t0),
		};
		return new WasmEngine({
			vm,
			versions: {
				tj: manifest.tj.version,
				tjCommit: manifest.tj.commit,
				rubyWasm: manifest.rubyWasm.version,
				bundleHash: manifest.bundle.sha256,
			},
			rubyVersion: ruby.ruby,
			timings,
			clearWorkspace: () => clearDirectory(fs.workspace),
			now,
		});
	} catch (error) {
		if (error instanceof EngineFailure) throw error;
		const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		throw new EngineFailure('boot', 'The engine could not start.', detail);
	}
}

/** The bundle document: `{ files: { "/tj/...": text }, schemaVersion: 1 }`. */
export function parseBundle(text: string): Record<string, string> {
	const doc: unknown = JSON.parse(text);
	if (!isRecord(doc) || doc['schemaVersion'] !== 1 || !isRecord(doc['files'])) {
		throw new EngineFailure('boot', 'The engine bundle is not schema version 1.');
	}
	const files: Record<string, string> = {};
	for (const [path, content] of Object.entries(doc['files'])) {
		if (typeof content !== 'string') throw new EngineFailure('boot', `Bundle file ${path} is not text.`);
		files[path] = content;
	}
	return files;
}
