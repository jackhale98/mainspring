# SPDX-License-Identifier: GPL-2.0-or-later
#
# tj_bridge.rb - browser entry point: run one ScheduleRequest in ruby.wasm and
# return the ScheduleResult as JSON (docs/phases/phase-0.md, sections 3.1, 3.2).
#
# Load order matters: wasm/tj_wasm_perf.rb patches Array/Hash before
# TaskJuggler loads; the time-zone, time and parser-cache patches change
# TaskJuggler classes, so they load after it. The worker must put TaskJuggler's
# lib/ and engine/stubs/ on $LOAD_PATH before requiring this file.
#
# Contract with the worker (src/engine/runtime.ts):
#
#   TJBridge.schedule(request_json) -> String (JSON)
#   TJBridge.syntax -> String (JSON)
#   TJBridge.versions -> String (JSON) { "tj", "ruby" }
#   TJBridge.tokens(text) -> String (JSON), Node only (see below)
#
# request_json is a ScheduleRequest: { files, entry, revision, options? }.
# The bridge replaces WORKSPACE (default /workspace, which the worker must
# provide as a writable directory) with `files`, parses /workspace/<entry> and
# schedules it. The reply is either a ScheduleResult (TaskJuggler errors are
# messages with ok: false) or, for a malformed request or a bridge/TaskJuggler
# crash, { "error": { "kind": "invalid-request" | "internal" | "crash",
# "message", "detail" } }, which the worker turns into a `failed` message.
# NoMemoryError and SystemStackError are "crash": the client then replaces the
# worker, since the VM may not recover from either.
#
# TJBridge.syntax returns SyntaxDocs (syntax.rb, required on first use so that
# booting does not pay for it) or the same { "error": ... } shape. The result
# is cached for the life of the VM.
#
# TJBridge.tokens is the token oracle of phase-1 T19 (tokens.rb, required on
# first use): TaskJuggler's own scanner tokens for one text, or the same
# { "error": ... } shape. Only Node tools call it (src/engine/runtime.ts
# NodeEngine); the worker protocol has no message for it. It touches neither
# the workspace nor any state a later schedule reads.
#
# timings: writeFsMs (request JSON parse and workspace write), parseMs,
# scheduleMs and serializeMs are measured here. totalMs is their sum as seen
# by the bridge (the final JSON.generate is not included); the worker may
# replace it with its end-to-end time.
#
# The fast path (fast_path.rb, phase-2 spike T19): a request with
# `retain: true` keeps its parsed project (`retainMs`); a request with
# `fast: { base, edits }` that fast_path.rb accepts skips the parse
# (`cloneMs`, `applyMs`, parseMs 0). `path` says which ran. Anything else
# runs in full. Only a full run with `retain` replaces the kept project
# (one at a time); other runs leave it, valid for the text it was parsed from.
#
# MAINSPRING_FORCE_WASM_PATCHES=1 loads the perf, stable-sort, time and
# parser-cache patches on native Ruby too (the Intl time-zone patch needs a JS
# host and is
# never loaded natively). This exists only to check natively that the patches
# change no results; the golden recorder never sets it.
require 'json'

module TJBridge
  WASM = RUBY_PLATFORM.include?('wasm')
  PATCHES = WASM || ENV['MAINSPRING_FORCE_WASM_PATCHES'] == '1'
  WORKSPACE = ENV.fetch('MAINSPRING_WORKSPACE', '/workspace')
end

require_relative 'wasm/tj_wasm_perf' if TJBridge::PATCHES
require_relative 'wasm/tj_wasm_sort' if TJBridge::PATCHES
require 'taskjuggler/TaskJuggler'
require_relative 'wasm/tj_wasm_tz' if TJBridge::WASM
require_relative 'wasm/tj_wasm_time' if TJBridge::PATCHES
require_relative 'wasm/tj_parser_cache' if TJBridge::PATCHES
require_relative 'request'
require_relative 'fast_path'

module TJBridge
  module_function

  def schedule(request_json)
    t0 = MainspringBridge.clock_ms
    begin
      # From JS, vm.wrap(string) arrives as a JS::Object; to_s gives the text.
      request_json = request_json.to_s unless request_json.is_a?(String)
      req = JSON.parse(request_json)
      raise MainspringBridge::InvalidRequest, 'request must be an object' unless req.is_a?(Hash)

      files = req['files']
      entry = req['entry']
      MainspringBridge.validate!(files, entry)
      options = req['options'] || {}
      raise MainspringBridge::InvalidRequest, 'options must be an object' unless options.is_a?(Hash)

      now = MainspringBridge.parse_now(options['now'])
    rescue JSON::ParserError, MainspringBridge::InvalidRequest => e
      return failure('invalid-request', e.message)
    end

    begin
      fast = fast_run(req, now)
      result, timings = fast.is_a?(Array) ? fast : full_run(req, files, entry, now, options)
      timings['fastFallback'] = fast if fast.is_a?(String)
      t1 = timings.delete('t1') || MainspringBridge.clock_ms
      result['revision'] = req['revision']
      timings['writeFsMs'] = (t1 - t0).round(1)
      timings['totalMs'] = (MainspringBridge.clock_ms - t0).round(1)
      result['timings'] = timings
      JSON.generate(result)
    rescue NoMemoryError, SystemStackError => e
      exception_failure('crash', e)
    rescue StandardError => e
      exception_failure('internal', e)
    end
  end

  # The fast path's run (fast_path.rb) as [result, timings], why it fell back
  # (a String), or nil without `fast`.
  def fast_run(req, now)
    return nil unless req['fast']

    t1 = MainspringBridge.clock_ms
    out = MainspringBridge::FastPath.try(req, WORKSPACE, now)
    out.is_a?(Array) ? [out[0], out[1].merge('t1' => t1)] : out
  end

  def full_run(req, files, entry, now, options)
    MainspringBridge.write_workspace(WORKSPACE, files)
    t1 = MainspringBridge.clock_ms
    fp = MainspringBridge::FastPath
    sites = MainspringBridge::FastPathSites
    keep = if req['retain'] == true
             fp.drop
             # Note the lines of the statements the fast path may rewrite while this run parses.
             sites.start
             lambda do |project, messages|
               fp.retain(revision: req['revision'], entry: entry, files: files,
                         now_option: options['now'], project: project, messages: messages,
                         capture: MainspringBridge::Capture, root: WORKSPACE, log: sites.stop)
             end
           end
    result, timings = MainspringBridge.run(WORKSPACE, entry, now, on_parsed: keep)
    if keep && fp.base.nil? && !timings.key?('retainError')
      # A parse with errors is never kept: request.rb calls on_parsed only after a clean one.
      timings['retainError'] = fp.unkept('the parse gave errors')
    end
    [result, timings.merge('path' => 'full', 't1' => t1)]
  ensure
    sites&.stop
  end

  def syntax
    @syntax ||= begin
      require_relative 'syntax'
      JSON.generate(MainspringBridge::SyntaxDocs.build)
    end
  rescue NoMemoryError, SystemStackError => e
    exception_failure('crash', e)
  rescue StandardError, ScriptError => e
    exception_failure('internal', e)
  end

  def tokens(text)
    require_relative 'tokens'
    text = text.to_s unless text.is_a?(String)
    MainspringBridge::Tokens.json(text)
  rescue NoMemoryError, SystemStackError => e
    exception_failure('crash', e)
  rescue StandardError, ScriptError => e
    exception_failure('internal', e)
  end

  def versions
    require 'taskjuggler/version'
    JSON.generate({ 'tj' => ::VERSION, 'ruby' => RUBY_VERSION })
  end

  def exception_failure(kind, err)
    failure(kind, "#{err.class}: #{err.message}",
            (err.backtrace || []).first(20).join("\n"))
  end

  def failure(kind, message, detail = nil)
    err = { 'kind' => kind, 'message' => message }
    err['detail'] = detail if detail
    JSON.generate({ 'error' => err })
  end
end
