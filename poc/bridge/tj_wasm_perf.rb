# tj_wasm_perf.rb - work around two slow paths in ruby.wasm (loaded on wasm only).
#
# ruby.wasm emulates setjmp/longjmp with Asyncify, which unwinds and rewinds
# the WebAssembly stack. Two everyday Ruby idioms hit that path:
#
#  1. `break` / `return` / `next`-out-of-method from a block that was yielded
#     by a C-implemented iterator (Array#each, Hash#each_value, ...) is a
#     longjmp: ~100+ us each vs ~0.2 us native.
#  2. Array#hash / Array#eql? / Array#== run under Ruby's recursion guard,
#     which does a setjmp: ~20 us per array-keyed Hash lookup.
#
# Re-implementing those iterators and comparisons in plain Ruby keeps all
# control flow inside the VM, so neither path is taken. Semantics match the
# C versions for TaskJuggler's use (no self-referential arrays).

class Array
  def each
    return to_enum(:each) { size } unless block_given?
    i = 0
    while i < size
      yield self[i]
      i += 1
    end
    self
  end

  def each_with_index
    return to_enum(:each_with_index) { size } unless block_given?
    i = 0
    while i < size
      yield self[i], i
      i += 1
    end
    self
  end

  def each_index
    return to_enum(:each_index) { size } unless block_given?
    i = 0
    while i < size
      yield i
      i += 1
    end
    self
  end

  def reverse_each
    return to_enum(:reverse_each) { size } unless block_given?
    i = size - 1
    while i >= 0
      yield self[i] if i < size
      i -= 1
    end
    self
  end

  def find(ifnone = nil)
    return to_enum(:find, ifnone) unless block_given?
    i = 0
    while i < size
      v = self[i]
      return v if yield(v)
      i += 1
    end
    ifnone&.call
  end
  alias_method :detect, :find

  def any?(*args)
    return super if !args.empty? || !block_given?
    i = 0
    while i < size
      return true if yield(self[i])
      i += 1
    end
    false
  end

  def all?(*args)
    return super if !args.empty? || !block_given?
    i = 0
    while i < size
      return false unless yield(self[i])
      i += 1
    end
    true
  end

  def hash
    h = size
    i = 0
    while i < size
      h = (h * 31 + self[i].hash) & 0x3fff_ffff_ffff
      i += 1
    end
    h
  end

  def eql?(other)
    return true if equal?(other)
    return false unless other.is_a?(Array) && other.size == size
    i = 0
    while i < size
      return false unless self[i].eql?(other[i])
      i += 1
    end
    true
  end

  def ==(other)
    return true if equal?(other)
    return false unless other.is_a?(Array)
    return false unless other.size == size
    i = 0
    while i < size
      return false unless self[i] == other[i]
      i += 1
    end
    true
  end
end

class Hash
  def each_value
    return to_enum(:each_value) { size } unless block_given?
    values.each { |v| yield v }
    self
  end

  def each_key
    return to_enum(:each_key) { size } unless block_given?
    keys.each { |k| yield k }
    self
  end

  def each
    return to_enum(:each) { size } unless block_given?
    to_a.each { |kv| yield kv }
    self
  end
  alias_method :each_pair, :each
end
