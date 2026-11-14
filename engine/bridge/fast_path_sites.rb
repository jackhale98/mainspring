# SPDX-License-Identifier: GPL-2.0-or-later
#
# fast_path_sites.rb - which statement each line of a kept parse ran, for the
# fast path (fast_path.rb, ADR-0010).
#
# The fast path must not take the main thread's word for which task and
# keyword a line belongs to: a wrong task id, a line in a block comment or a
# report, a macro body used by two tasks, a file included twice, or a value
# carrying more statements would all apply cleanly to the wrong thing. So
# while a run that asks to be kept is parsed, the bridge records, for every
# action of a keyword the fast path rewrites (and milestone, which shares the
# duration family, and period, which sets start and end), the line of its
# keyword token, the property it ran on, the keyword and the scenario. An edit
# is accepted only when its line ran exactly one such action, for that task and
# keyword, in the top scenario, and no later action of the same family ran on
# that task. It also notes every task an attr_overwrite warning was given for
# (the warning itself names no property), and the fast path refuses to rewrite
# those.
#
# How: the patterns of TaskJuggler's :taskScenarioAttributes rule whose first
# token is one of these keywords, and the pattern of :taskPeriod (which
# :taskScenarioAttributes reaches through `!taskPeriod`, TjpSyntaxRules.rb:
# 6159-6163, 6592), are wrapped, once per pattern object, so that each call is
# noted before the original action runs (TextParser.rb:385-397 calls
# `state.pattern.function` with @sourceFileInfo, @property and @scenarioIdx
# set on the parser, which the action closes over). No other rule reached from
# :taskScenarioAttributes sets one of the noted attributes. attr_overwrite is
# reported through the scanner's `warning` (TextParser.rb:397), which is
# hooked to note the parser's @property. File names are expanded, so one file
# included as "common.tji" and "./common.tji" is one file. Nothing is noted
# unless a kept run is being parsed; engine/tj is not changed, and the native
# recorder never loads this file's hooks (only a request with `retain` turns
# them on).
module MainspringBridge
  module FastPathSites
    # Keywords whose actions are noted: those the fast path rewrites, milestone, and period.
    NOTED = %w[effort length duration milestone start end priority complete period].freeze
    # The rules whose patterns are wrapped: the task attributes, and period's own rule.
    RULES = %i[taskScenarioAttributes taskPeriod].freeze
    # A noted action: where its keyword token is, the task, the keyword, the scenario index
    # and its place in parse order.
    Site = Struct.new(:file, :line, :task, :keyword, :scenario, :seq)

    class << self
      # The actions noted so far, or nil when no kept run is being parsed.
      attr_reader :log
      # The parser of the kept run being parsed, for the attr_overwrite hook.
      attr_accessor :parser

      def start
        @log = []
      end

      # The noted actions, and stop noting.
      def stop
        out = @log
        @log = nil
        @parser = nil
        out
      end

      # Wraps the noted patterns of _parser_ (once per pattern object).
      def wrap(parser)
        RULES.each { |name| wrap_rule(parser, name) }
      end

      def wrap_rule(parser, name)
        rule = parser.instance_variable_get(:@rules)&.fetch(name, nil)
        return unless rule

        rule.patterns.each do |pattern|
          next if pattern.instance_variable_get(:@__mainspring_noted)

          token = pattern.tokens.first
          next unless token && token[0] == :literal && NOTED.include?(token[1])

          original = pattern.function
          next unless original

          keyword = token[1]
          pattern.instance_variable_set(:@function, lambda do
            FastPathSites.note(parser, keyword) if FastPathSites.log
            original.call
          end)
          pattern.instance_variable_set(:@__mainspring_noted, true)
        end
      end

      def note(parser, keyword)
        sfi = parser.instance_variable_get(:@sourceFileInfo)&.first
        property = parser.instance_variable_get(:@property)
        task = property.is_a?(TaskJuggler::Task) ? property.fullId : nil
        @log << Site.new(sfi&.fileName.to_s, sfi&.lineNo, task, keyword,
                         parser.instance_variable_get(:@scenarioIdx), @log.length)
      end

      # An attr_overwrite warning while a kept run is parsed: notes the task it was for.
      def overwrite
        property = @parser&.instance_variable_get(:@property)
        return unless property.is_a?(TaskJuggler::Task)

        @log << Site.new(nil, nil, property.fullId, OVERWRITE, nil, @log.length)
      end

      # A source file name as a workspace path: expanded (no "." or ".." left), relative to _root_.
      def workspace_path(name, root)
        File.expand_path(name.to_s, root).delete_prefix("#{File.expand_path(root)}/")
      end

      # The noted actions by [workspace path, line], by task, and the tasks an attr_overwrite was
      # given for, for a kept base.
      def index(log, root)
        by_line = Hash.new { |h, k| h[k] = [] }
        by_task = Hash.new { |h, k| h[k] = [] }
        overwritten = {}
        log.each do |s|
          if s.keyword == OVERWRITE
            overwritten[s.task] = true
            next
          end
          site = s.dup
          site.file = workspace_path(s.file, root)
          by_line[[site.file, site.line]] << site
          by_task[site.task] << site if site.task
        end
        [by_line, by_task, overwritten]
      end
    end

    # The keyword of a noted attr_overwrite (not a TaskJuggler keyword).
    OVERWRITE = 'attr_overwrite'

    # Notes actions while a kept run is parsed (see the module comment).
    module ParserHook
      def open(file, master, fileNameIsBuffer = false)
        if FastPathSites.log
          FastPathSites.wrap(self)
          FastPathSites.parser = self
        end
        super
      end
    end

    # Notes the task of each attr_overwrite warning while a kept run is parsed.
    module ScannerHook
      def warning(id, text, sfi = nil, data = nil)
        FastPathSites.overwrite if id == 'attr_overwrite' && FastPathSites.log
        super
      end
    end

    TaskJuggler::ProjectFileParser.prepend(ParserHook)
    TaskJuggler::TextParser::Scanner.prepend(ScannerHook)
  end
end
