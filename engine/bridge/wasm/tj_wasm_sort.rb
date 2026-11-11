# SPDX-License-Identifier: GPL-2.0-or-later
#
# tj_wasm_sort.rb - sort ties as native Linux Ruby does, under ruby.wasm.
# Wasm only. These are re-implementations of Ruby core methods, not
# TaskJuggler code.
#
# Array#sort, Array#sort! and Enumerable#sort (so Hash#sort too) end in
# Ruby's ruby_qsort, which is the C library's qsort_r when there is a usable
# one and Ruby's own quicksort otherwise. On Linux, glibc's qsort_r is a merge
# sort (glibc 2.39 and later, and 2.36 and earlier), so equal elements keep
# their order. wasi-libc has none, so ruby.wasm uses the quicksort, which
# reorders them. TaskJuggler sorts with ties in places, for example the
# resource candidates of `select minallocated` (Allocation#candidates, which
# compares criticalness only), so the browser picked a different resource
# than native tj3 (golden plan syn-15-allocate-select).
#
# A stable sort's result depends only on the input order and the comparison,
# not on the algorithm, so making these three methods stable reproduces the
# native Linux results exactly. Each runs the original C sort over element
# indexes with the index as the last tie-breaker; comparison results are read
# as Ruby's rb_cmpint does (nil raises ArgumentError).
#
# sort_by is left alone on purpose: Ruby 3.3+ sorts uniform numeric keys with
# its own introsort on every platform (unstable, but the same code natively
# and in wasm), and only other keys go through qsort_r. TaskJuggler never
# calls sort_by, and the bridge only calls it with unique keys.
#
# The native recorder refuses to record unless native Ruby sorts these ties
# stably (engine/golden/record-native.mjs), so goldens never come from an
# unstable libc sort (macOS, or glibc 2.37 and 2.38).
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

  # A new Array with the elements of _ary_ in stable sorted order, compared
  # with _blk_ or with <=>.
  def sorted(ary, blk)
    return ary.dup if ary.size < 2

    idx = Array.new(ary.size) { |i| i }
    idx.__tj_unstable_sort! do |i, j|
      a = ary[i]
      b = ary[j]
      c = cmpint(blk ? blk.call(a, b) : (a <=> b), a, b)
      c.zero? ? i <=> j : c
    end
    idx.map { |i| ary[i] }
  end
end

class Array
  alias_method :__tj_unstable_sort!, :sort!

  def sort(&blk)
    TJWasmSort.sorted(self, blk)
  end

  def sort!(&blk)
    replace(TJWasmSort.sorted(self, blk))
  end
end

module Enumerable
  def sort(&blk)
    TJWasmSort.sorted(to_a, blk)
  end
end
