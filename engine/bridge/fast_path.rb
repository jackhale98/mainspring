# SPDX-License-Identifier: GPL-2.0-or-later
#
# fast_path.rb - the parse-skipping fast path (docs/phases/phase-2.md,
# section 12; spike T19, outcome in docs/decisions/0010-*.md).
#
# A full run that asks for it (`retain: true`) keeps a copy of its parsed,
# unscheduled project: Marshal, taken right after parsing and before
# Project#schedule. A later request with `fast: { base, edits }` whose text
# differs from that run's text only by in-place value rewrites then skips the
# parse: it loads a copy of the kept project, applies each rewrite with
# TaskJuggler's own grammar rule for that keyword, schedules the copy and
# serializes it. Anything this file cannot vouch for falls back to a full run
# (`FastPath.try` returns nil), so the result is always the full run's.
#
# Why it can work: TaskJuggler parses into a Project, and Project#schedule
# reads only that Project. Marshal round-trips the whole graph except the
# default procs of PropertyTreeNode's attribute hashes (PropertyTreeNode.rb:
# 58-85), which this file takes off before the dump and installs again, bound
# to each copy, after the load (the same code, so attributes created on
# demand behave the same).
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
# What the bridge checks itself (the main thread checks the rest, ADR-0010):
# - it holds the base run, with the same entry, file set and options.now;
#   when the plan took `now` from the clock, the clock's hour is unchanged;
# - every file is the base text except the lines the edits name, each an
#   in-place `<keyword> <value>` statement before and after, same line count;
# - the keyword is effort, length, duration, start, end, priority or
#   complete, for the top scenario only;
# - the task exists; a keyword its children inherit (start, end, priority)
#   is only rewritten on a leaf, since children copy it at creation
#   (PropertyTreeNode#inheritAttributes, called by the parser);
# - no other scenario provides the attribute: a top-scenario value is copied
#   to derived scenarios as it is set (PropertyTreeNode.rb:459-477), which
#   would overwrite theirs;
# - for start and end, the task's direction is already the one the pattern
#   sets, so the order of statements in the task does not matter;
# - the base parse gave no message on an edited line.
#
# Messages: the base run's parse messages are kept and the schedule's added,
# as a full parse of the same text would give them (none is on an edited
# line). Golden runs never send `fast` or `retain`.
require 'json'

module MainspringBridge
  module FastPath
    KEYWORDS = %w[effort length duration start end priority complete].freeze
    # The attributes each keyword's pattern sets (see the module comment).
    SETS = {
      'effort' => %w[effort length duration milestone],
      'length' => %w[effort length duration milestone],
      'duration' => %w[effort length duration milestone],
      'start' => %w[start],
      'end' => %w[end],
      'priority' => %w[priority],
      'complete' => %w[complete]
    }.freeze
    # The direction ('forward') the start and end patterns set.
    FORWARD = { 'start' => true, 'end' => false }.freeze

    # The kept run: what it was given, its parse messages and the dump.
    Base = Struct.new(:revision, :entry, :files, :now_option, :clock_now, :blob,
                      :messages, :version, :timezone, keyword_init: true)

    class << self
      attr_reader :base

      # Forget the kept run (a full run that does not retain, or a failure).
      def drop
        @base = nil
      end

      # Keep _project_, just parsed and not yet scheduled. Returns ms spent.
      def retain(revision:, entry:, files:, now_option:, project:, messages:, capture:)
        t0 = MainspringBridge.clock_ms
        @base = nil
        blob = without_default_procs(project) { Marshal.dump(project) }
        @base = Base.new(
          revision: revision, entry: entry,
          files: files.transform_values { |t| MainspringBridge.normalize_text(t) },
          now_option: now_option,
          # nil when the plan or options.now set `now`; else the clock hour it used.
          clock_now: capture.clock.nil? && !capture.now_line ? project['now'] : nil,
          blob: blob, messages: messages.dup,
          version: capture.version, timezone: capture.timezone
        )
        (MainspringBridge.clock_ms - t0).round(1)
      end

      # The fast run of _req_ as [result, timings], or a String: why it must run in full.
      # An exception while trying is a reason too: the full run then shows what is wrong.
      def try(req, root, now)
        catch(:fallback) do
          fast = req['fast']
          b = @base
          fallback('no kept run') unless b
          fallback('another base') unless fast.is_a?(Hash) && fast['base'] == b.revision
          fallback('entry or options changed') unless req['entry'] == b.entry &&
                                                      req['options'].to_h['now'] == b.now_option
          edits = fast['edits']
          fallback('no edits') unless edits.is_a?(Array) && !edits.empty?
          fallback('not an in-place rewrite') unless edits_in_place?(req['files'], edits)
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

      def edits_in_place?(files, edits)
        return false unless files.is_a?(Hash) && files.keys.sort == @base.files.keys.sort

        by_file = Hash.new { |h, k| h[k] = {} }
        edits.each do |e|
          return false unless e.is_a?(Hash) && KEYWORDS.include?(e['attribute']) && e['scenario'].nil?
          return false unless e['task'].is_a?(String) && e['value'].is_a?(String) && e['file'].is_a?(String)
          return false unless e['line'].is_a?(Integer) && e['line'].positive?
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
            e ? statement?(old[i], e['attribute'], nil) && statement?(now[i], e['attribute'], e['value']) : old[i] == now[i]
          end
        end && by_file.keys.all? { |p| files.key?(p) }
      end

      # One `<keyword> <value>` statement on a line, with an optional comment.
      def statement?(line, keyword, value)
        v = value ? Regexp.escape(value) : '[^\s#]+'
        /\A[ \t]*#{keyword}[ \t]+#{v}[ \t]*(?:(?:#|\/\/)[^\r]*)?\r?\z/.match?(line)
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
        install_default_procs(project)
        t1 = MainspringBridge.clock_ms
        edits.each { |e| applicable!(project, e) }
        fallback('the rewrite gave a message') unless apply(project, edits, root) && mh.messages.empty?

        b.messages.each { |m| mh.messages << m }
        t2 = MainspringBridge.clock_ms
        tj = TaskJuggler.new
        tj.instance_variable_set(:@project, project)
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

        file = sfi.fileName.to_s.delete_prefix("#{root}/")
        file == edit['file']
      end

      # The checks that need the kept project (see the module comment).
      def applicable!(project, e)
        task = project.task(e['task'])
        fallback("no task #{e['task']}") unless task

        attr = e['attribute']
        set = task.propertySet
        others = (1...project.scenarioCount).to_a
        SETS[attr].each do |a|
          definition = set.attributeDefinition(a)
          fallback("no attribute #{a}") unless definition
          fallback("#{a} is inherited by children") if definition.inheritedFromParent && !task.leaf?
          fallback("another scenario sets #{a}") if others.any? { |sc| task.provided(a, sc) }
        end
        fallback('the direction would change') if FORWARD.key?(attr) && task['forward', 0] != FORWARD[attr]
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
          ok = MainspringBridge.guarded(TaskJuggler::MessageHandlerInstance.instance) do
            parser.parse(:propertiesFile)
          end
          parser.close
          return false unless ok
        end
        true
      ensure
        Dir.chdir(root) rescue nil
      end

      def nodes(project)
        %i[@scenarios @shifts @accounts @resources @tasks @reports].flat_map do |iv|
          project.instance_variable_get(iv).instance_variable_get(:@properties)
        end
      end

      def without_default_procs(project)
        saved = nodes(project).map do |n|
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

      # The default procs of PropertyTreeNode#initialize (PropertyTreeNode.rb:58-85), bound to
      # each node of the copy.
      def install_default_procs(project)
        nodes(project).each do |n|
          n.instance_eval do
            @attributes.default_proc = proc do |hash, attributeId|
              unless (aType = attributeDefinition(attributeId))
                raise ArgumentError,
                      "Unknown attribute '#{attributeId}' requested for " \
                      "#{self.class.to_s.sub(/TaskJuggler::/, '')} '#{fullId}'"
              end
              raise ArgumentError, "Attribute '#{attributeId}' is scenario specific" if aType.scenarioSpecific

              hash[attributeId] = aType.objClass.new(@propertySet, aType, self)
            end
            @scenarioAttributes.each_with_index do |h, scenarioIdx|
              h.default_proc = proc do |hash, attributeId|
                unless (aType = attributeDefinition(attributeId))
                  raise ArgumentError,
                        "Unknown attribute '#{attributeId}' requested for " \
                        "#{self.class.to_s.sub(/TaskJuggler::/, '')} '#{fullId}'"
                end
                raise ArgumentError, "Attribute '#{attributeId}' is not scenario specific" unless aType.scenarioSpecific

                hash[attributeId] = aType.objClass.new(@propertySet, aType, @data[scenarioIdx])
              end
            end
          end
        end
      end
    end
  end
end
