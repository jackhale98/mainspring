# tj_wasm_time.rb - keep TaskJuggler dates as small integers under ruby.wasm.
#
# ruby.wasm is 32-bit, so Ruby's immediate integers stop at 2**30. Epoch
# seconds (~1.8e9 today) are Bignums there, and so is every Time object's
# internal value: date math that is ~10 ns natively costs 1-3 us.
#
# TjTime now also stores @s = seconds since 2000-01-01 UTC, which stays an
# immediate integer until 2034. Adding, subtracting and comparing dates uses
# @s, and the Time object is only built when something needs it (formatting,
# calendar math, local-time conversion). Results are identical: TjTime#+
# already truncated to whole seconds, and anything with sub-second precision
# (only Time.now) falls back to the original code.
class TaskJuggler
  class TjTime
    EPOCH0 = 946_684_800 # 2000-01-01T00:00:00Z

    alias_method :__tj_orig_initialize, :initialize
    def initialize(t = nil)
      if t.is_a?(Integer)
        @s = t - EPOCH0
        @time = nil
      elsif t.is_a?(TjTime) && (s = t.__s)
        @s = s
        @time = nil
      else
        __tj_orig_initialize(t)
        @s = nil
      end
    end

    def self.__from_s(s)
      o = allocate
      o.instance_variable_set(:@s, s)
      o.instance_variable_set(:@time, nil)
      o
    end

    # Whole seconds since EPOCH0, or nil when the Time has a fractional part.
    def __s
      return @s if @s
      return nil if @time.nil? || @time.subsec != 0
      @s = @time.to_i - EPOCH0
    end

    def time
      @time ||= Time.at(@s + EPOCH0)
    end

    # Methods that read @time directly: materialize it first, then run the
    # original implementation unchanged.
    %i[utc % upto hoursLater to_s gmtime localtime].each do |m|
      orig = instance_method(m)
      define_method(m) do |*args, &blk|
        time
        orig.bind_call(self, *args, &blk)
      end
    end

    def +(secs)
      if secs.is_a?(Integer)
        TjTime.__from_s((@s || (time.to_i - EPOCH0)) + secs)
      else
        TjTime.new(time.to_i + secs)
      end
    end

    def -(arg)
      if arg.is_a?(TjTime)
        a = __s
        b = arg.__s
        return (a - b).to_f if a && b
        time - arg.time
      elsif arg.is_a?(Integer)
        TjTime.__from_s((@s || (time.to_i - EPOCH0)) - arg)
      else
        TjTime.new(time.to_i - arg)
      end
    end

    def <(t)
      return false unless t
      (a = __s) && (b = t.__s) ? a < b : time < t.time
    end

    def <=(t)
      return false unless t
      (a = __s) && (b = t.__s) ? a <= b : time <= t.time
    end

    def >(t)
      return true unless t
      (a = __s) && (b = t.__s) ? a > b : time > t.time
    end

    def >=(t)
      return true unless t
      (a = __s) && (b = t.__s) ? a >= b : time >= t.time
    end

    def ==(t)
      return false unless t
      (a = __s) && (b = t.__s) ? a == b : time == t.time
    end

    def <=>(t)
      return -1 unless t
      (a = __s) && (b = t.__s) ? a <=> b : time <=> t.time
    end
  end
end
