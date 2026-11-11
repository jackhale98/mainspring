# SPDX-License-Identifier: GPL-2.0-or-later
#
# request.rb - ScheduleRequest semantics shared by the browser entry
# (tj_bridge.rb) and the native golden recorder (native/record.rb), so both
# sides parse, schedule and serialize a workspace the same way.
#
# A run:
#  1. replaces the workspace directory with the request's files (each text
#     scrubbed to valid UTF-8 and stripped of a leading BOM, see below);
#  2. parses <root>/<entry> with TaskJuggler (includes resolve relative to the
#     including file, so the whole workspace is reachable);
#  3. schedules every active scenario;
#  4. serializes the result with serialize.rb.
# Reports are never generated.
#
# options.now (ADR-0002, decision 1) stands in for the system clock that
# TaskJuggler reads when a plan has no `now` line: Project#initialize keeps its
# default `TjTime.new.align(3600)`, but with the clock reading options.now. A
# `now` line in the plan overrides it, exactly as it overrides the clock.
#
# Source text: workspace files are UTF-8 text. Invalid UTF-8 byte sequences
# become U+FFFD (the same maximal-subpart rule as the browser's TextDecoder)
# and one leading U+FEFF (BOM) is removed, which TextDecoder also does by
# default. The browser only ever passes valid strings, so this matters for the
# native recorder, and it makes both sides agree whichever JS decoder read
# the files. See engine/golden/README.md, "Recording native outputs".
#
# This file adds two small hooks to TaskJuggler::Project (clock and metadata
# capture). It changes no scheduling behaviour; all other TaskJuggler code is
# used unmodified.
require 'fileutils'
require_relative 'serialize'

module MainspringBridge
  # The request itself is malformed (bad path, missing entry, bad `now`).
  class InvalidRequest < StandardError; end

  BOM = "﻿"
  NOW_RE = /\A(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z\z/.freeze

  # Hooks into TaskJuggler::Project. State lives in module attributes for the
  # duration of one run and is reset by MainspringBridge.run.
  module ProjectHooks
    def initialize(id, name, version)
      super
      Capture.header = self
      Capture.version = version
      if (clock = Capture.clock)
        @attributes['now'] = TaskJuggler::TjTime.new(clock).align(3600)
      end
    end

    def []=(name, value)
      Capture.timezone = value if name == 'timezone'
      super
    end
  end

  module Capture
    class << self
      attr_accessor :clock, :header, :version, :timezone

      def reset(clock)
        @clock = clock
        @header = nil
        @version = nil
        @timezone = nil
      end
    end
  end

  TaskJuggler::Project.prepend(ProjectHooks)

  module_function

  # A WorkspacePath: relative POSIX path, no '..', '.', empty segments or
  # backslashes.
  def check_path!(path, what = 'path')
    ok = path.is_a?(String) && !path.empty? && !path.start_with?('/') &&
         !path.include?('\\') && !path.include?("\0") &&
         path.split('/', -1).none? { |s| s.empty? || s == '.' || s == '..' }
    raise InvalidRequest, "invalid #{what}: #{path.inspect}" unless ok

    path
  end

  # nil, or a Time for an ISO 8601 UTC string such as "2026-01-05T09:00:00Z".
  def parse_now(now)
    return nil if now.nil?

    m = now.is_a?(String) && NOW_RE.match(now)
    raise InvalidRequest, "options.now must be ISO 8601 UTC: #{now.inspect}" unless m

    Time.utc(*m.captures.map(&:to_i))
  rescue ArgumentError
    raise InvalidRequest, "options.now is not a valid date: #{now.inspect}"
  end

  def normalize_text(text)
    t = text.to_s.dup.force_encoding(Encoding::UTF_8)
    t = t.scrub("�") unless t.valid_encoding?
    t.start_with?(BOM) ? t[1..] : t
  end

  # Replace the contents of _root_ with _files_ ({ WorkspacePath => text }).
  def write_workspace(root, files)
    FileUtils.mkdir_p(root)
    Dir.children(root).each { |c| FileUtils.rm_rf(File.join(root, c)) }
    files.each do |path, text|
      full = File.join(root, path)
      FileUtils.mkdir_p(File.dirname(full))
      File.binwrite(full, normalize_text(text))
    end
  end

  def validate!(files, entry)
    raise InvalidRequest, 'files must be an object' unless files.is_a?(Hash)

    files.each do |path, text|
      check_path!(path, 'file path')
      raise InvalidRequest, "file #{path} is not a string" unless text.is_a?(String)
    end
    check_path!(entry, 'entry')
    raise InvalidRequest, "entry #{entry} is not in files" unless files.key?(entry)
  end

  def clock_ms
    Process.clock_gettime(Process::CLOCK_MONOTONIC) * 1000.0
  end

  # Parse, schedule and serialize <root>/<entry>. The workspace must already
  # hold the files. _now_ is a Time or nil. Returns [result Hash, timings Hash].
  def run(root, entry, now)
    Encoding.default_external = Encoding::UTF_8
    mh = TaskJuggler::MessageHandlerInstance.instance
    mh.reset
    mh.outputLevel = :none   # never print; messages are returned instead
    mh.hideScenario = false  # keep the scenario on each message
    mh.trapSetup = true      # raise TjRuntimeError instead of calling exit
    Capture.reset(now)

    previous = begin
      Dir.pwd
    rescue SystemCallError
      nil
    end
    Dir.chdir(root)
    t0 = clock_ms
    tj = TaskJuggler.new
    parsed = guarded(mh) { tj.parse([File.join(root, entry)]) }
    t1 = clock_ms
    scheduled = parsed && guarded(mh) { tj.schedule }
    t2 = clock_ms
    ok = parsed && scheduled && mh.errors.zero?
    header = Capture.header
    header = nil unless header && header['start'] && header['end']
    result = Serializer.result(
      ok: ok, project: parsed ? tj.project : nil, header: header,
      meta: { 'version' => Capture.version, 'timezone' => Capture.timezone },
      messages: mh.messages, workspace_root: root
    )
    t3 = clock_ms
    [result, { 'parseMs' => (t1 - t0).round(1),
               'scheduleMs' => (t2 - t1).round(1),
               'serializeMs' => (t3 - t2).round(1) }]
  ensure
    Capture.reset(nil)
    restore_dir(previous)
  end

  # Return to the directory a run started in. Under WASI the start directory
  # is "/", which is not a preopened directory and cannot be entered again;
  # the run then stays in the workspace, which is harmless.
  def restore_dir(dir)
    Dir.chdir(dir) if dir
  rescue SystemCallError
    nil
  end

  # Run a TaskJuggler step. Errors that TaskJuggler reports as messages end
  # the step with false; anything else is a bug and propagates.
  def guarded(mh)
    count = mh.messages.length
    res = yield
    res ? true : false
  rescue TaskJuggler::TjRuntimeError, TaskJuggler::TjException
    false
  rescue RuntimeError => e
    # MessageHandler#fatal records the message, then raises a bare RuntimeError.
    raise unless e.instance_of?(RuntimeError) && mh.messages.length > count &&
                 mh.messages.last.type == :fatal

    false
  end
end
