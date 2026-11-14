# SPDX-License-Identifier: GPL-2.0-or-later
#
# fast_path.rb - the parse-skipping fast path (docs/phases/phase-2.md,
# section 12; spike T19, outcome in docs/decisions/0010-fast-path.md).
#
# A full run that asks for it (`retain: true`) keeps a copy of its parsed,
# unscheduled project: Marshal, taken right after parsing and before
# Project#schedule, with the lines each rewritable statement ran on
# (fast_path_sites.rb). A later request with `fast: { base, edits }` whose
# text differs from that run's text only by in-place value rewrites then skips
# the parse: it loads a copy of the kept project, applies each rewrite with
# TaskJuggler's own grammar rule for that keyword, schedules the copy and
# serializes it. Anything this file cannot vouch for runs in full
# (`FastPath.try` returns the reason), so the result is always the full run's.
#
# Why it can work: TaskJuggler parses into a Project, and Project#schedule
# reads only that Project and TjTime's zone. Marshal round-trips the whole
# graph except the default procs of PropertyTreeNode's attribute hashes,
# which are taken off for the dump and put back on each copy
# (fast_path_procs.rb).
#
# Applying a rewrite: the statement is parsed as a `supplement task <id>`
# block, so the keyword's own pattern runs with its parse-time side effects
# (setDurationAttribute resetting the other criteria, ProjectFileParser.rb:
# 295-310; start and end setting 'forward', TjpSyntaxRules.rb:6449, 6794;
# range checks). The attributes that pattern sets were provided by the
# original statement, so they are marked not provided first: otherwise the
# setter raises AttributeOverwrite (PropertyTreeNode.rb:455-496), which the
# parser turns into an attr_overwrite warning, and setDurationAttribute
# reports multiple_durations. Any message during the apply falls back.
#
# What the bridge checks itself, whatever the main thread sent (ADR-0010):
# - it holds the base run, with the same entry, file set and options.now;
#   when the plan took `now` from the clock, the clock's hour is unchanged;
# - each value, old and new, is strictly a value of its keyword (no space,
#   brace, '#', '$' or quote can get in, so no macro call that could hide
#   more statements), and every file is the base text except the lines the
#   edits name, each a lone `<keyword> <value>` statement before and after,
#   with the same line count;
# - the keyword is effort, length, duration, start, end, priority or
#   complete, for the top scenario only;
# - the edited line ran exactly one noted action in the kept parse, of that
#   keyword, on that task, in the top scenario, and no later action of the
#   same family ran on that task (fast_path_sites.rb; `period` is in the
#   start and end families); file names are compared expanded;
# - the base parse gave no attr_overwrite warning for that task;
# - an attribute the pattern sets that children inherit (inheritedFromParent:
#   of these, priority) is only rewritten on a leaf, since children copy it
#   when they are created (PropertyTreeNode#inheritAttributes), not when they
#   are scheduled;
# - no other scenario provides an attribute the pattern sets: a top-scenario
#   value is copied to derived scenarios as it is set (PropertyTreeNode.rb:
#   459-477), which would overwrite theirs;
# - for start and end, the direction ('forward') is already the one the
#   pattern sets, in every scenario: the pattern sets it in the top scenario
#   and copies it to the derived ones, so a later `test:end` or `late:depends`
#   would otherwise be undone;
# - the base parse gave no message on an edited line.
#
# Messages: the base run's parse messages are kept as plain data (no link to
# the base run's project) and the schedule's are added, as a full parse of
# the same text would give them. Golden runs never send `fast` or `retain`.
require 'json'
require_relative 'fast_path_procs'
require_relative 'fast_path_sites'

module MainspringBridge
  module FastPath
    KEYWORDS = %w[effort length duration start end priority complete].freeze
    DURATIONS = %w[effort length duration milestone].freeze
    # The attributes each keyword's pattern sets (see the module comment).
    SETS = {
      'effort' => DURATIONS, 'length' => DURATIONS, 'duration' => DURATIONS,
      'start' => %w[start], 'end' => %w[end], 'priority' => %w[priority], 'complete' => %w[complete]
    }.freeze
    # Keywords whose later action would set the same attributes again: period sets start and end
    # (TjpSyntaxRules.rb:6159-6163).
    FAMILY = SETS.merge('start' => %w[start period], 'end' => %w[end period]).freeze
    # The direction ('forward') the start and end patterns set.
    FORWARD = { 'start' => true, 'end' => false }.freeze
    DURATION_VALUE = /\A\d+(?:\.\d+)?(?:min|h|d|w|m|y)\z/.freeze
    DATE_VALUE = %r{\A\d{4}-\d{2}-\d{2}(?:-\d{1,2}:\d{2}(?::\d{2})?)?(?:-(?:[+-]\d{4}|[A-Za-z][A-Za-z0-9_+/-]*))?\z}.freeze
    # The values each keyword may be rewritten to (strict: one token, nothing else).
    VALUES = {
      'effort' => DURATION_VALUE, 'length' => DURATION_VALUE, 'duration' => DURATION_VALUE,
      'start' => DATE_VALUE, 'end' => DATE_VALUE,
      'priority' => /\A\d{1,4}\z/.freeze, 'complete' => /\A\d{1,3}(?:\.\d+)?\z/.freeze
    }.freeze

    # A base parse message as the serializer reads it (serialize.rb #message: type, id, message,
    # sourceFileInfo and @scenario's fullId), without the property and scenario objects that
    # would keep the base run's scheduled project alive.
    class KeptMessage
      attr_reader :type, :id, :message, :sourceFileInfo

      def initialize(m)
        @type = m.type
        @id = m.id
        @message = m.message
        @sourceFileInfo = m.sourceFileInfo
        sc = m.instance_variable_get(:@scenario)
        @scenario = sc && KeptScenario.new(sc.fullId)
      end

      def self.of(m)
        new(m)
      end
    end
    KeptScenario = Struct.new(:fullId)

    # The kept run: what it was given, its parse messages, the noted sites and the dump.
    # tz: TjTime's active zone after the parse, which scheduling reads (TjTime.rb:90-106; the
    # parser sets it from `timezone`, TjpSyntaxRules.rb:7137, and TaskJuggler.new resets it).
    Base = Struct.new(:revision, :entry, :files, :now_option, :clock_now, :blob, :messages,
                      :version, :timezone, :tz, :by_line, :by_task, :overwritten,
                      keyword_init: true)

    class << self
      attr_reader :base

      # Forget the kept run (a new run asks to be kept).
      def drop
        @base = nil
        @retain_error = nil
      end

      # Notes why a run that asked to be kept was not; returns the reason.
      def unkept(reason)
        @retain_error = reason
      end

      # Keep _project_, just parsed and not yet scheduled, with the actions noted while it was
      # parsed. Returns the timings to add: `retainMs` and `retainBytes`, or `retainError` when
      # the project cannot be copied (it holds an object Marshal cannot dump: ShiftAssignments
      # is a Monitor, ShiftAssignments.rb:100), and then nothing is kept.
      def retain(revision:, entry:, files:, now_option:, project:, messages:, capture:, root:, log:)
        t0 = MainspringBridge.clock_ms
        @base = nil
        @retain_error = nil
        blob = begin
          without_default_procs(project) { Marshal.dump(project) }
        rescue TypeError => e
          return { 'retainError' => unkept(e.message) }
        end
        by_line, by_task, overwritten = FastPathSites.index(log || [], root)
        @base = Base.new(
          revision: revision, entry: entry,
          files: files.transform_values { |t| MainspringBridge.normalize_text(t) },
          now_option: now_option,
          # nil when the plan or options.now set `now`; else the clock hour it used.
          clock_now: capture.clock.nil? && !capture.now_line ? project['now'] : nil,
          blob: blob, messages: messages.map { |m| KeptMessage.of(m) },
          version: capture.version, timezone: capture.timezone, tz: TaskJuggler::TjTime.timeZone,
          by_line: by_line, by_task: by_task, overwritten: overwritten
        )
        { 'retainMs' => (MainspringBridge.clock_ms - t0).round(1), 'retainBytes' => blob.bytesize }
      end

      # The fast run of _req_ as [result, timings], or a String: why it must run in full.
      # An exception while trying is a reason too: the full run then shows what is wrong.
      def try(req, root, now)
        catch(:fallback) do
          fast = req['fast']
          b = @base
          fallback(@retain_error ? "no kept run (#{@retain_error})" : 'no kept run') unless b
          fallback('another base') unless fast.is_a?(Hash) && fast['base'] == b.revision
          fallback('entry or options changed') unless req['entry'] == b.entry &&
                                                      req['options'].to_h['now'] == b.now_option
          edits = fast['edits']
          fallback('no edits') unless edits.is_a?(Array) && !edits.empty?
          edits.each { |e| well_formed!(e) }
          fallback('not an in-place rewrite') unless edits_in_place?(req['files'], edits)
          edits.each { |e| one_statement!(b, e) }
          fallback('the clock hour changed') if b.clock_now && TaskJuggler::TjTime.new.align(3600) != b.clock_now

          run(b, edits, root, now)
        rescue StandardError => e
          "#{e.class}: #{e.message}"
        end
      end

      def fallback(reason)
        throw :fallback, reason
      end

      private

      def well_formed!(e)
        fallback('a malformed edit') unless e.is_a?(Hash) && KEYWORDS.include?(e['attribute']) &&
                                            e['scenario'].nil? && e['task'].is_a?(String) &&
                                            e['file'].is_a?(String) && e['line'].is_a?(Integer) &&
                                            e['line'].positive? && e['value'].is_a?(String)
        fallback("not a value of #{e['attribute']}") unless VALUES[e['attribute']].match?(e['value'])
      end

      def edits_in_place?(files, edits)
        return false unless files.is_a?(Hash) && files.keys.sort == @base.files.keys.sort

        by_file = Hash.new { |h, k| h[k] = {} }
        edits.each do |e|
          return false if by_file[e['file']].key?(e['line'])

          by_file[e['file']][e['line']] = e
        end
        files.all? do |path, text|
          old = @base.files[path].split("\n", -1)
          now = MainspringBridge.normalize_text(text).split("\n", -1)
          next false unless old.length == now.length

          lines = by_file.fetch(path, {})
          old.each_index.all? do |i|
            e = lines[i + 1]
            e ? old_value?(old[i], e['attribute']) && statement?(now[i], e['attribute'], e['value']) : old[i] == now[i]
          end
        end && by_file.keys.all? { |p| files.key?(p) }
      end

      # One `<keyword> <value>` statement on a line, with an optional comment.
      def statement?(line, keyword, value)
        v = value ? Regexp.escape(value) : '[^\s#]+'
        /\A[ \t]*#{keyword}[ \t]+#{v}[ \t]*(?:(?:#|\/\/)[^\r]*)?\r?\z/.match?(line)
      end

      # The line before the rewrite: one statement whose value is strictly a value of _keyword_
      # (so not a macro call, which can hide more statements: `effort ${d}` with `d` = `5d
      # allocate s`).
      def old_value?(line, keyword)
        m = /\A[ \t]*#{keyword}[ \t]+([^\s#]+)[ \t]*(?:(?:#|\/\/)[^\r]*)?\r?\z/.match(line)
        m && VALUES[keyword].match?(m[1])
      end

      # The edited line ran one noted action: this keyword, on this task, in the top scenario,
      # and no later action of the same family ran on the task (fast_path_sites.rb).
      def one_statement!(b, e)
        sites = b.by_line[[e['file'], e['line']]] || []
        site = sites.first
        unless sites.length == 1 && site.task == e['task'] && site.keyword == e['attribute'] && site.scenario.zero?
          fallback('the line is not one statement of that task')
        end
        later = b.by_task[e['task']].any? { |s| s.seq > site.seq && FAMILY[e['attribute']].include?(s.keyword) }
        fallback('a later statement sets it again') if later
        fallback('the base parse overwrote an attribute of that task') if b.overwritten[e['task']]
      end

      def run(b, edits, root, now)
        t0 = MainspringBridge.clock_ms
        mh = TaskJuggler::MessageHandlerInstance.instance
        mh.reset
        mh.outputLevel = :none
        mh.hideScenario = false
        mh.trapSetup = true
        fallback('a parse message on an edited line') if edits.any? { |e| b.messages.any? { |m| on_line?(m, root, e) } }

        project = Marshal.load(b.blob)
        FastPathProcs.install(project)
        # The global state a full run has after its parse: TaskJuggler.new resets the zone to
        # UTC, the plan's `timezone` set it again.
        tj = TaskJuggler.new
        tj.instance_variable_set(:@project, project)
        TaskJuggler::TjTime.setTimeZone(b.tz)
        t1 = MainspringBridge.clock_ms
        edits.each { |e| applicable!(project, e) }
        applied = apply(project, edits, root)
        unless applied && mh.messages.empty?
          m = mh.messages.first
          fallback(m ? "the rewrite gave a message: #{m.id} #{m.message}" : 'the rewrite failed')
        end

        b.messages.each { |m| mh.messages << m }
        t2 = MainspringBridge.clock_ms
        Capture.reset(now)
        previous = Dir.pwd rescue nil
        Dir.chdir(root)
        scheduled = MainspringBridge.guarded(mh) { tj.schedule }
        t3 = MainspringBridge.clock_ms
        result = Serializer.result(
          ok: scheduled && mh.errors.zero?, project: project, header: project,
          meta: { 'version' => b.version, 'timezone' => b.timezone },
          messages: mh.messages, workspace_root: root
        )
        t4 = MainspringBridge.clock_ms
        [result, { 'parseMs' => 0, 'cloneMs' => (t1 - t0).round(1), 'applyMs' => (t2 - t1).round(1),
                   'scheduleMs' => (t3 - t2).round(1), 'serializeMs' => (t4 - t3).round(1),
                   'path' => 'fast' }]
      ensure
        Capture.reset(nil) if t0
        MainspringBridge.restore_dir(previous) if previous
      end

      def on_line?(message, root, edit)
        sfi = message.sourceFileInfo
        return false unless sfi && sfi.lineNo == edit['line']

        FastPathSites.workspace_path(sfi.fileName, root) == edit['file']
      end

      # The checks that need the kept project (see the module comment).
      def applicable!(project, e)
        task = project.task(e['task'])
        fallback("no task #{e['task']}") unless task

        attr = e['attribute']
        others = (1...project.scenarioCount).to_a
        SETS[attr].each do |a|
          definition = task.attributeDefinition(a)
          fallback("no attribute #{a}") unless definition
          fallback("#{a} is inherited by children") if definition.inheritedFromParent && !task.leaf?
          fallback("another scenario sets #{a}") if others.any? { |sc| task.provided(a, sc) }
        end
        return unless FORWARD.key?(attr)

        same = (0...project.scenarioCount).all? { |sc| task['forward', sc] == FORWARD[attr] }
        fallback('the direction would change') unless same
      end

      # Each rewrite through TaskJuggler's grammar: `supplement task <id> { <statement> }`.
      def apply(project, edits, root)
        TaskJuggler::AttributeBase.setMode(0)
        edits.each do |e|
          task = project.task(e['task'])
          SETS[e['attribute']].each do |a|
            task.getAttribute(a, 0).instance_variable_set(:@provided, false)
          end
          text = "supplement task #{e['task']} {\n  #{e['attribute']} #{e['value']}\n}\n"
          parser = TaskJuggler::ProjectFileParser.new
          parser.open(text, false, true)
          parser.instance_variable_set(:@project, project)
          parser.setGlobalMacros
          # As TaskJuggler#parse reads it (TaskJuggler.rb:73): only false is a failure.
          ok = MainspringBridge.guarded(TaskJuggler::MessageHandlerInstance.instance) do
            parser.parse(:propertiesFile) != false
          end
          parser.close
          return false unless ok
        end
        true
      ensure
        Dir.chdir(root) rescue nil
      end

      def without_default_procs(project)
        saved = FastPathProcs.nodes(project).map do |n|
          a = n.instance_variable_get(:@attributes)
          s = n.instance_variable_get(:@scenarioAttributes)
          procs = [a.default_proc, s.map(&:default_proc)]
          a.default_proc = nil
          s.each { |h| h.default_proc = nil }
          [n, procs]
        end
        yield
      ensure
        saved&.each do |n, (ap, sps)|
          n.instance_variable_get(:@attributes).default_proc = ap
          n.instance_variable_get(:@scenarioAttributes).each_with_index { |h, i| h.default_proc = sps[i] }
        end
      end
    end
  end
end
