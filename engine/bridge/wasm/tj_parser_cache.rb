# SPDX-License-Identifier: GPL-2.0-or-later
#
# tj_parser_cache.rb - build TaskJuggler's grammar state machine once.
# Ported unchanged from poc/bridge/tj_parser_cache.rb.
#
# Why it lives in wasm/: the cache is safe on both sides, but it only pays off
# in a long-lived process that parses many times, which is the browser worker.
# The native recorder parses once per Ruby process, so there the cache would
# never be reused; leaving it out keeps native recording on unmodified
# TaskJuggler (spec 6.2). The golden parity suite then tests the cache for
# free: it runs the whole corpus through one long-lived worker in shuffled
# order and must match the fresh-process native outputs (spec 6.3, "State
# leakage"). Natively it can still be exercised with
# MAINSPRING_FORCE_WASM_PATCHES=1 (see tj_bridge.rb).
#
# ProjectFileParser.new compiles ~380 grammar rules into a ~1800-state parser
# FSM on every parse. That is input-independent work, so we keep one parser
# and reset it between parses instead.
#
# One wrinkle: an `extend task/resource { ... }` block adds patterns for the
# user's custom attributes to existing rules and rebuilds @states. We undo
# that by truncating each rule's pattern list back to its original length and
# restoring the pristine @states hash (rebuilds always assign a new Hash, so
# the original one is never mutated).
class TaskJuggler
  class ProjectFileParser
    class << self
      alias_method :__tj_uncached_new, :new
      def new
        if @cached
          @cached.__tj_reset_for_reuse
        else
          @cached = __tj_uncached_new
          @cached.__tj_snapshot_fresh_state
        end
        @cached
      end
    end

    def __tj_snapshot_fresh_state
      @__rules0 = @rules.dup
      @__patternCounts = @rules.transform_values { |r| r.patterns.length }
      @__states0 = @states
      @__fresh = (instance_variables - %i[@rules @states] -
                  instance_variables.grep(/\A@__/)).to_h do |v|
        val = instance_variable_get(v)
        [v, (val.is_a?(Hash) || val.is_a?(Array)) ? val.dup : val]
      end
    end

    def __tj_reset_for_reuse
      grammarChanged = @rules.size != @__rules0.size ||
                       @__patternCounts.any? { |n, c| @rules[n].patterns.length != c }
      if grammarChanged || !@states.equal?(@__states0)
        @rules = @__rules0.dup
        @__patternCounts.each do |name, count|
          pats = @rules[name].patterns
          pats.slice!(count..) if pats.length > count
        end
        @rules.each_value(&:flushCache)
        @states = @__states0
      end
      (instance_variables - %i[@rules @states] -
       instance_variables.grep(/\A@__/)).each { |v| remove_instance_variable(v) }
      @__fresh.each do |v, val|
        instance_variable_set(v, (val.is_a?(Hash) || val.is_a?(Array)) ? val.dup : val)
      end
    end
  end
end
