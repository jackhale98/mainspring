# tj_bridge.rb - parse + schedule a TaskJuggler project held in a string and
# return the scheduled result as JSON. Runs unchanged under native Ruby and
# ruby.wasm.
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8
require 'json'
WASM = RUBY_PLATFORM.include?('wasm')
require 'tj_wasm_perf' if WASM || ENV['TJ_FORCE_PERF_PATCH']
require 'taskjuggler/TaskJuggler'
require 'tj_wasm_tz' if WASM
require 'tj_wasm_time' if (WASM || ENV['TJ_FORCE_PERF_PATCH']) && !ENV['TJ_NO_TIME_PATCH']
require 'tj_parser_cache' unless ENV['TJ_NO_PARSER_CACHE']

module TJBridge
  module_function

  def iso(t)
    t && t.respond_to?(:to_s) ? t.to_s('%Y-%m-%dT%H:%M') : nil
  end

  def run(src, file = 'plan.tjp')
    File.write(file, src)
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    tj = TaskJuggler.new
    mh = TaskJuggler::MessageHandlerInstance.instance
    mh.trapSetup = true        # raise instead of calling exit on errors
    mh.outputLevel = 0 if mh.respond_to?(:outputLevel=)
    ok_parse = begin
      tj.parse([file])
    rescue TaskJuggler::TjRuntimeError, TaskJuggler::TjException
      false
    end
    t1 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    ok_sched = ok_parse && begin
      tj.schedule
    rescue TaskJuggler::TjRuntimeError, TaskJuggler::TjException
      false
    end
    t2 = Process.clock_gettime(Process::CLOCK_MONOTONIC)

    msgs = TaskJuggler::MessageHandlerInstance.instance.messages.map do |m|
      sfi = m.sourceFileInfo
      { type: m.type, id: m.id, message: m.message,
        line: sfi && sfi.lineNo, column: sfi && sfi.columnNo }
    end

    out = { ok: !!ok_sched, parseMs: ((t1 - t0) * 1000).round,
            scheduleMs: ((t2 - t1) * 1000).round, messages: msgs }

    if ok_sched
      p = tj.project
      out[:project] = { id: p['projectid'], name: p['name'], now: iso(p['now']),
                        start: iso(p['start']), end: iso(p['end']) }
      out[:resources] = p.resources.to_ary.map { |r| { id: r.fullId, name: r.name } }
      out[:tasks] = p.tasks.to_ary.map do |t|
        sfi = t.sourceFileInfo
        { id: t.fullId, name: t.name, parent: t.parent && t.parent.fullId,
          level: t.level, leaf: t.leaf?,
          start: iso(t['start', 0]), end: iso(t['end', 0]),
          milestone: !!t['milestone', 0],
          complete: t['complete', 0],
          depends: (t['depends', 0] || []).map { |d| d.task.fullId },
          resources: (t['assignedresources', 0] || []).map(&:fullId),
          line: sfi && sfi.lineNo }
      end
    end
    out.to_json
  end
end
