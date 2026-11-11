# SPDX-License-Identifier: GPL-2.0-or-later
#
# cross-check-shim.rb - loaded with `ruby -r` into the tj3 process that
# record-native.mjs runs for the serializer cross-check (cross-check.tji).
# Used only there; never by the bridge or the native recorder.
#
# It changes tj3 in three narrow ways and reports TaskJuggler's own state:
#
# 1. MAINSPRING_CLOCK (ISO 8601 UTC, whole hour), when set, pins Time.now.
#    TaskJuggler's default `now` is the clock aligned to the hour, so a plan
#    without a `now` line gets the same `now` as the bridge's options.now.
# 2. TaskJuggler#schedule returns false on TjRuntimeError instead of letting
#    the error end tj3 (Tj3AppBase#main sets trapSetup and returns 1 when one
#    escapes, so `-f` never got to write the report). The bridge serializes
#    the partial schedule after such an error; with this, tj3 reports it too.
#    trapSetup is also set here, so an error raises rather than calls exit.
# 3. User config files (.taskjugglerrc in the cwd, $HOME or /etc) are not
#    read, so a developer's settings cannot change the run.
#
# MAINSPRING_TJ3_OUT, when set, names a file that gets JSON at exit:
#   { "scheduled": true|false|null,       # null: schedule never ran
#     "project": { "start", "end", "now", "scenarios": [{ "id", "active" }] } | null,
#     "messages": [{ "level", "id", "text", "file", "line" }] }
# The messages are those emitted up to the end of scheduling, so warnings
# from report generation, which the bridge never does, are left out.
require 'json'
require 'time'
require 'taskjuggler/TaskJuggler'
require 'taskjuggler/RuntimeConfig'

module MainspringCrossCheck
  @state = { 'scheduled' => nil, 'project' => nil }
  @messageCount = nil

  class << self
    attr_reader :state
    attr_accessor :messageCount
  end

  def self.iso(t)
    t && t.to_s('%Y-%m-%dT%H:%M:%SZ', 'UTC')
  end

  def self.snapshot(project, scheduled)
    mh = TaskJuggler::MessageHandlerInstance.instance
    @messageCount = mh.messages.length
    @state['scheduled'] = scheduled ? true : false
    return unless project

    @state['project'] = {
      'start' => iso(project['start']), 'end' => iso(project['end']),
      'now' => iso(project['now']),
      'scenarios' => project.scenarios.to_ary.map do |sc|
        { 'id' => sc.fullId, 'active' => sc.get('active') ? true : false }
      end
    }
  end

  module ScheduleHook
    def schedule
      TaskJuggler::MessageHandlerInstance.instance.trapSetup = true
      ok = begin
        super
      rescue TaskJuggler::TjRuntimeError
        false
      end
      MainspringCrossCheck.snapshot(project, ok)
      ok
    end
  end

  module NoConfigFiles
    def loadConfigFile(_fileName)
      false
    end
  end
end

TaskJuggler.prepend(MainspringCrossCheck::ScheduleHook)
::RuntimeConfig.prepend(MainspringCrossCheck::NoConfigFiles)

if (clock = ENV['MAINSPRING_CLOCK']) && !clock.empty?
  MAINSPRING_CLOCK = Time.iso8601(clock).to_i
  class Time
    def self.now(**kw)
      Time.at(MAINSPRING_CLOCK, **kw)
    end
  end
end

at_exit do
  if (out = ENV['MAINSPRING_TJ3_OUT'])
    mh = TaskJuggler::MessageHandlerInstance.instance
    msgs = mh.messages.first(MainspringCrossCheck.messageCount || mh.messages.length)
    File.write(out, JSON.generate(MainspringCrossCheck.state.merge(
      'messages' => msgs.map do |m|
        sfi = m.sourceFileInfo
        { 'level' => m.type.to_s, 'id' => m.id.to_s, 'text' => m.message.to_s,
          'file' => sfi && sfi.fileName, 'line' => sfi && sfi.lineNo }
      end
    )))
  end
end
