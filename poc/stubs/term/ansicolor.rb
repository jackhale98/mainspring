# Minimal stand-in for the term-ansicolor gem: the browser has no terminal,
# so every color helper just returns its text unchanged.
module Term
  module ANSIColor
    COLORS = %i[black red green yellow blue magenta cyan white bold dark
                italic underline blink reverse clear uncolored reset negative concealed strikethrough
                on_black on_red on_green on_yellow on_blue on_magenta on_cyan on_white]
    COLORS.each do |c|
      define_method(c) { |str = nil, &blk| str.nil? ? (blk ? blk.call : '') : str.to_s }
      module_function c
    end
    def self.coloring=(v); @coloring = v; end
    def self.coloring?; false; end
  end
end
