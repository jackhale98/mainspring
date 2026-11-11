# SPDX-License-Identifier: GPL-2.0-or-later
#
# term/ansicolor.rb - browser stand-in for the term-ansicolor gem (ported from
# poc/stubs/term/ansicolor.rb).
#
# The browser has no terminal, so every colour helper returns its text
# unchanged and colouring is always off. TaskJuggler uses these helpers only
# for console output (Message#to_s, Log); the bridge reads message text
# directly and never prints it.
#
# Loaded only in the browser bundle. The native golden recorder uses the real
# term-ansicolor gem pinned in engine/golden/Gemfile.lock.
module Term
  module ANSIColor
    COLORS = %i[black red green yellow blue magenta cyan white bold dark
                italic underline blink reverse clear uncolored reset negative
                concealed strikethrough
                on_black on_red on_green on_yellow on_blue on_magenta on_cyan
                on_white].freeze

    COLORS.each do |c|
      define_method(c) { |str = nil, &blk| str.nil? ? (blk ? blk.call : '') : str.to_s }
      module_function c
    end

    def self.coloring=(v)
      @coloring = v
    end

    def self.coloring?
      false
    end
  end
end
