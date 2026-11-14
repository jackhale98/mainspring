# SPDX-License-Identifier: GPL-2.0-only
#
# Near-copy of TaskJuggler code: Pattern#generateStates and the method_missing
# delegators below re-implement those of engine/tj/lib/taskjuggler/
# TextParser/Pattern.rb, PropertyList.rb, Resource.rb, Account.rb and
# Shift.rb (TaskJuggler 3.8.4, Copyright (c) 2006-2014 by Chris Schlaeger,
# GPL-2.0-only) and keep their structure. This file is therefore
# GPL-2.0-only, like TaskJuggler, not GPL-2.0-or-later like the rest of
# Mainspring. Integer#upto and #downto are independent re-implementations of
# Ruby core methods.
#
# tj_wasm_jumps.rb - stop the memory leak of non-local jumps under ruby.wasm.
#
# The leak: Ruby 3.4 built for WebAssembly keeps each VM tag's jump buffer on
# the heap (vm_core.h rb_vm_tag_jmpbuf_init: ruby_xmalloc of an Asyncify
# buffer, 24,636 bytes in @ruby/3.4-wasm-wasi 2.10.1); EC_POP_TAG frees it.
# Every vm_exec pushes a tag, and every call from C code into Ruby code
# (a block yielded by a C iterator, a method called by Method#call) runs its
# own vm_exec. A break, return, throw or raise that leaves such a vm_exec
# skips its EC_POP_TAG (vm.c vm_exec_handle_exception unlinks the tag and
# jumps on), so the buffer is never freed. Natively the tag lives on the C
# stack and nothing leaks. Ruby's GC cannot see this memory: GC.stat and
# ObjectSpace stay flat while the wasm memory grows, and wasm memory never
# shrinks. Measured: one leaked buffer per jump, exactly 24,636 bytes.
#
# The fix: keep the jumps TaskJuggler makes on every run inside one vm_exec
# (Ruby code yielding to Ruby code), the way wasm/tj_wasm_perf.rb already
# does for Array#each and friends. Each patch keeps the original's results:
#
#  - Pattern#generateStates broke out of `downto(0).each` (an Enumerator: C)
#    once per grammar pattern, about 330 times (8 MB) on every parse of a plan
#    with an `extend` block, which rebuilds the parser tables.
#  - PropertyList, Resource, Account and Shift forward unknown methods with
#    `obj.method(func).call`; Method#call is C, so `tasks.each { return ... }`
#    on a PropertyList leaked a buffer each time (gantt-200: about 130 per
#    run). Ruby's `__send__` dispatches in the VM. A method the target does
#    not have still goes through `method(func)`, so the error is unchanged.
#  - Integer#upto and #downto are C; TaskJuggler returns from inside their
#    blocks in scheduling code (Project#isWorkingTime?, hasWorkingTime,
#    ResourceScenario#allocated?, WorkingHours#timeOff?, TaskScenario's
#    length check). With an Integer limit they now loop in Ruby; any other
#    limit, and the blockless form, use the original C methods.
#
# Jumps on other paths (an exception out of a block yielded by C, an early
# exit from a C iterator TaskJuggler rarely runs) still leak, 24 KB each;
# the client restarts a worker whose memory grows too large (client.ts).
class Integer
  alias_method :__tj_c_upto, :upto
  alias_method :__tj_c_downto, :downto

  def upto(limit, &block)
    return __tj_c_upto(limit, &block) unless block_given? && limit.is_a?(Integer)

    i = self
    while i <= limit
      yield i
      i += 1
    end
    self
  end

  def downto(limit, &block)
    return __tj_c_downto(limit, &block) unless block_given? && limit.is_a?(Integer)

    i = self
    while i >= limit
      yield i
      i -= 1
    end
    self
  end
end

class TaskJuggler
  class TextParser
    class Pattern
      # TextParser/Pattern.rb:106-132, with the downto(0).each loop as a while loop.
      def generateStates(rule, rules)
        firstReduceableToken = @tokens.length - 1
        i = @tokens.length - 2
        while i >= 0
          # Token i + 1 is not optional: token i + 1 is the first to reduce.
          break unless optionalToken(i + 1, rules)

          # Token i + 1 is optional: assume token i is the first to reduce.
          firstReduceableToken = i
          i -= 1
        end

        states = []
        @tokens.length.times do |j|
          states << (state = State.new(rule, self, j))
          # Mark all states that are allowed to trigger a reduce operation.
          state.noReduce = false if j >= firstReduceableToken
        end
        states
      end
    end
  end

  class PropertyList
    # PropertyList.rb:65-67.
    def method_missing(func, *args, &block)
      return @items.method(func).call(*args, &block) unless @items.respond_to?(func, true)

      @items.__send__(func, *args, &block)
    end
  end

  class Resource
    # Resource.rb:41-43.
    def method_missing(func, scenarioIdx = 0, *args, &block)
      data = @data[scenarioIdx]
      return data.method(func).call(*args, &block) unless data.respond_to?(func, true)

      data.__send__(func, *args, &block)
    end
  end

  class Account
    # Account.rb:39-41.
    def method_missing(func, scenarioIdx, *args)
      data = @data[scenarioIdx]
      return data.method(func).call(*args) unless data.respond_to?(func, true)

      data.__send__(func, *args)
    end
  end

  class Shift
    # Shift.rb:38-40.
    def method_missing(func, scenarioIdx = 0, *args)
      data = @data[scenarioIdx]
      return data.method(func).call(*args) unless data.respond_to?(func, true)

      data.__send__(func, *args)
    end
  end
end
