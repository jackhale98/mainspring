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
# Contract with the worker (src/engine/worker.ts):
#
#   TJBridge.schedule(request_json) -> String (JSON)
#
# request_json is a ScheduleRequest: { files, entry, revision, options? }.
# The bridge replaces WORKSPACE (default /workspace, which the worker must
# provide as a writable directory) with `files`, parses /workspace/<entry> and
# schedules it. The reply is either a ScheduleResult (TaskJuggler errors are
# messages with ok: false) or, for a malformed request or a bridge/TaskJuggler
# crash, { "error": { "kind": "invalid-request" | "internal", "message",
# "detail" } }, which the worker turns into a `failed` message.
#
# timings: writeFsMs (request JSON parse and workspace write), parseMs,
# scheduleMs and serializeMs are measured here. totalMs is their sum as seen
# by the bridge (the final JSON.generate is not included); the worker may
# replace it with its end-to-end time.
#
# MAINSPRING_FORCE_WASM_PATCHES=1 loads the perf, time and parser-cache
# patches on native Ruby too (the Intl time-zone patch needs a JS host and is
# never loaded natively). This exists only to check natively that the patches
# change no results; the golden recorder never sets it.
require 'json'

module TJBridge
  WASM = RUBY_PLATFORM.include?('wasm')
  PATCHES = WASM || ENV['MAINSPRING_FORCE_WASM_PATCHES'] == '1'
  WORKSPACE = ENV.fetch('MAINSPRING_WORKSPACE', '/workspace')
end

require_relative 'wasm/tj_wasm_perf' if TJBridge::PATCHES
require 'taskjuggler/TaskJuggler'
require_relative 'wasm/tj_wasm_tz' if TJBridge::WASM
require_relative 'wasm/tj_wasm_time' if TJBridge::PATCHES
require_relative 'wasm/tj_parser_cache' if TJBridge::PATCHES
require_relative 'request'

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
      MainspringBridge.write_workspace(WORKSPACE, files)
      t1 = MainspringBridge.clock_ms
      result, timings = MainspringBridge.run(WORKSPACE, entry, now)
      result['revision'] = req['revision']
      timings['writeFsMs'] = (t1 - t0).round(1)
      timings['totalMs'] = (MainspringBridge.clock_ms - t0).round(1)
      result['timings'] = timings
      JSON.generate(result)
    rescue StandardError, NoMemoryError, SystemStackError => e
      failure('internal', "#{e.class}: #{e.message}",
              (e.backtrace || []).first(20).join("\n"))
    end
  end

  def failure(kind, message, detail = nil)
    err = { 'kind' => kind, 'message' => message }
    err['detail'] = detail if detail
    JSON.generate({ 'error' => err })
  end
end
