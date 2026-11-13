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
# duration family), the line of its keyword token, the property it ran on, the
# keyword and the scenario. An edit is accepted only when its line ran exactly
# one such action, for that task and keyword, in the top scenario, and no
# later action of the same family ran on that task.
#
# How: the patterns of TaskJuggler's :taskScenarioAttributes rule are wrapped,
# once per pattern object, so that each call is noted before the original
# action runs (TextParser.rb:385-397 calls `state.pattern.function` with
# @sourceFileInfo, @property and @scenarioIdx set on the parser, which the
# action closes over). Nothing is noted unless a kept run is being parsed;
# engine/tj is not changed, and the native recorder never loads this file's
# hook (only a request with `retain` turns it on).
module MainspringBridge
  module FastPathSites
    # Keywords whose actions are noted: those the fast path rewrites, and milestone.
    NOTED = %w[effort length duration milestone start end priority complete].freeze
    # A noted action: where its keyword token is, the task, the keyword, the scenario index
    # and its place in parse order.
    Site = Struct.new(:file, :line, :task, :keyword, :scenario, :seq)

    class << self
      # The actions noted so far, or nil when no kept run is being parsed.
      attr_reader :log

      def start
        @log = []
      end

      # The noted actions, and stop noting.
      def stop
        out = @log
        @log = nil
        out
      end

      # Wraps the noted patterns of _parser_ (once per pattern object).
      def wrap(parser)
        rule = parser.instance_variable_get(:@rules)&.fetch(:taskScenarioAttributes, nil)
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

      # The noted actions by [workspace path, line], and by task, for a kept base.
      def index(log, root)
        by_line = Hash.new { |h, k| h[k] = [] }
        by_task = Hash.new { |h, k| h[k] = [] }
        log.each do |s|
          site = s.dup
          site.file = s.file.delete_prefix("#{root}/")
          by_line[[site.file, site.line]] << site
          by_task[site.task] << site if site.task
        end
        [by_line, by_task]
      end
    end

    # Notes actions while a kept run is parsed (see the module comment).
    module ParserHook
      def open(file, master, fileNameIsBuffer = false)
        FastPathSites.wrap(self) if FastPathSites.log
        super
      end
    end

    TaskJuggler::ProjectFileParser.prepend(ParserHook)
  end
end
