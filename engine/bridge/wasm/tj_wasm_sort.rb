# SPDX-License-Identifier: GPL-2.0-or-later
#
# tj_wasm_sort.rb - sort ties as native Linux Ruby does, under ruby.wasm.
# Wasm only. These are re-implementations of Ruby core methods, not
# TaskJuggler code.
#
# Array#sort, Array#sort! and Enumerable#sort (so Hash#sort too) end in
# Ruby's ruby_qsort, which is the C library's qsort_r when there is a usable
# one and Ruby's own quicksort otherwise. glibc's qsort_r is a merge sort in
# every released version, so on a glibc-based Linux equal elements keep their
# order (its only unstable path is a fallback when the merge buffer cannot be
# allocated, far beyond plan sizes). wasi-libc has no qsort_r, so ruby.wasm
# uses Ruby's quicksort, which reorders ties. TaskJuggler sorts with ties in
# places, for example the resource candidates of `select minallocated`
# (Allocation#candidates compares criticalness only), so the browser picked a
# different resource than native tj3 (golden plan syn-15-allocate-select).
#
# A stable sort's result depends only on the input order and the comparison,
# not on the algorithm, so making these three methods stable reproduces the
# native glibc results exactly. Each runs the original C sort over element
# indexes with the index as the last tie-breaker; comparison results are read
# as Ruby's rb_cmpint does (nil raises ArgumentError). Without a block, an
# array whose elements are all Integer, Symbol, true, false or nil goes
# straight to the original sort: equal values of those types are the same
# object, so the order of ties cannot be observed. Float (0.0 and -0.0 are
# equal but differ) and String (equal strings can be distinct objects) do not
# take the fast path.
#
# sort_by is left alone on purpose: Ruby 3.3+ sorts uniform numeric keys with
# its own introsort on every platform (unstable, but the same code natively
# and in wasm), and only other keys go through qsort_r. TaskJuggler never
# calls sort_by, and the bridge only calls it with unique keys.
#
# Native recording uses unmodified TaskJuggler without this file. Before each
# run, engine/golden/record-native.mjs checks that native Ruby sorts ties
# stably (it does not on macOS or musl/Alpine) and that this file, loaded
# natively, gives identical results.
module TJWasmSort
  module_function

  def cmpint(c, a, b)
    case c
    when Integer then c
    when nil then raise ArgumentError, "comparison of #{a.class} with #{b.class} failed"
    else
      if c > 0 then 1
      elsif c < 0 then -1
      else 0
      end
    end
  end

  # True if every element is an Integer, Symbol, true, false or nil.
  def indistinguishable_ties?(ary)
    i = 0
    n = ary.size
    while i < n
      case ary[i]
      when Integer, Symbol, true, false, nil then i += 1
      else return false
      end
    end
    true
  end

  # A new Array with the elements of _ary_ in stable sorted order, compared
  # with _blk_ or with <=>.
  def sorted(ary, blk)
    return Array.new.concat(ary) if ary.size < 2

    if blk.nil? && indistinguishable_ties?(ary)
      return Array.new.concat(ary).__tj_unstable_sort!
    end

    idx = Array.new(ary.size) { |i| i }
    idx.__tj_unstable_sort! do |i, j|
      a = ary[i]
      b = ary[j]
      c = cmpint(blk ? blk.call(a, b) : (a <=> b), a, b)
      c.zero? ? i <=> j : c
    end
    idx.map { |i| ary[i] }
  end

  # The elements an Enumerable yields, packed as Enumerable#to_a packs them
  # (no value: nil; one: itself; several: an Array), without calling a to_a
  # that the class may override.
  def collect(enum)
    out = []
    enum.each { |*v| out << (v.size <= 1 ? v[0] : v) }
    out
  end
end

class Array
  unless method_defined?(:__tj_unstable_sort!)
    alias_method :__tj_unstable_sort!, :sort!

    def sort(&blk)
      TJWasmSort.sorted(self, blk)
    end

    def sort!(&blk)
      replace(TJWasmSort.sorted(self, blk))
    end
  end
end

module Enumerable
  def sort(&blk)
    TJWasmSort.sorted(TJWasmSort.collect(self), blk)
  end
end
