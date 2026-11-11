// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Worker-side errors and how they map to `EngineError` kinds (the contract is the JSDoc on
 * `EngineErrorKind` in protocol.ts):
 *
 * - `EngineFailure` carries its own kind: `boot` for manifest, download, hash and Ruby start-up
 *   problems; `invalid-request` and `internal` for errors the bridge reports for one request;
 *   `crash` once the Ruby VM is unusable.
 * - `WebAssembly.RuntimeError` (a trap) and `RangeError` (wasm out of memory, stack overflow) are
 *   `crash`: the wasm instance may be half-way through a call, so it cannot be trusted again.
 * - Anything else is `internal`.
 *
 * Messages are diagnostics, not user-facing copy (views show the kind through strings.ts).
 */
import type { EngineError, EngineErrorKind } from './protocol';

export class EngineFailure extends Error {
	readonly kind: EngineErrorKind;
	readonly detail: string | undefined;

	constructor(kind: EngineErrorKind, message: string, detail?: string) {
		super(message);
		this.name = 'EngineFailure';
		this.kind = kind;
		this.detail = detail;
	}
}

/** True for errors after which the wasm instance must not be used again. */
export function isFatalWasmError(error: unknown): boolean {
	return error instanceof WebAssembly.RuntimeError || error instanceof RangeError;
}

function describe(error: unknown): string {
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	return String(error);
}

/** The `EngineError` for something thrown while handling a request (or while booting). */
export function toEngineError(error: unknown, fallback: EngineErrorKind = 'internal'): EngineError {
	if (error instanceof EngineFailure) {
		const out: EngineError = { kind: error.kind, message: error.message };
		if (error.detail !== undefined) out.detail = error.detail;
		return out;
	}
	if (isFatalWasmError(error)) {
		return { kind: 'crash', message: 'The engine stopped unexpectedly.', detail: describe(error) };
	}
	const message =
		fallback === 'boot' ? 'The engine could not start.' : 'The engine failed on this request.';
	return { kind: fallback, message, detail: describe(error) };
}
