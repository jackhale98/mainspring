# SPDX-License-Identifier: GPL-2.0-or-later
#
# token_scanner.rb - the scanning half of the token oracle (tokens.rb, which documents what it
# returns). OracleScanner is TaskJuggler's ProjectFileScanner with observers: LineMap, mixed
# into the scanner's stream handle, reports every pattern match with its offsets, and the
# subclass groups matches into tokens and trivia. Patterns, modes, their order, line reading and
# the splicing of text into a line all stay TaskJuggler's own code. Only two hooks act instead of
# TaskJuggler: expandMacro and environmentVariable splice the call's prefix and one `_` back into
# the line, where TaskJuggler would splice in the macro's text or the variable's value.
require 'taskjuggler/TaskJuggler'

module MainspringBridge
  module Tokens
    PLACEHOLDER = '_'
    WHITESPACE = /\A[ \t\n\v\f\r]/.freeze

    # A segment list maps byte positions in the scanner's current line to byte offsets in the
    # scanned text. Segment: [line_from, line_to, text_from, text_to, call]. call is nil for text
    # read from the buffer (both ranges have the same length), or the index of the macro call
    # whose one-byte placeholder it is (text_from...text_to is then the whole call).
    module Segments
      module_function

      def map_start(segs, pos)
        segs.each do |lf, lt, tf, _tt, call|
          return call ? tf : tf + (pos - lf) if pos >= lf && pos < lt
        end
        segs.empty? ? 0 : segs.last[3]
      end

      def map_end(segs, pos)
        segs.each do |lf, lt, tf, tt, call|
          return call ? tt : tf + (pos - lf) if pos > lf && pos <= lt
        end
        segs.empty? ? 0 : segs.first[2]
      end

      def calls(segs, from, to)
        segs.filter_map { |lf, lt, _tf, _tt, call| call if call && lf >= from && lt <= to }
      end

      # The segments of line_from...line_to, moved so that line_from becomes 0.
      def slice(segs, from, to)
        segs.filter_map do |lf, lt, tf, tt, call|
          a = [lf, from].max
          b = [lt, to].min
          next if a >= b

          if call
            [a - from, b - from, tf, tt, call]
          else
            [a - from, b - from, tf + a - lf, tf + b - lf, nil]
          end
        end
      end

      def shift(segs, by)
        segs.map { |lf, lt, tf, tt, call| [lf + by, lt + by, tf, tt, call] }
      end
    end

    # Extends the scanner's BufferStreamHandle: keeps the segment list of the current line and
    # reports every match to the scanner. All reading and splicing is TaskJuggler's own code.
    module LineMap
      attr_writer :ms_inject

      def ms_attach(owner)
        @ms_owner = owner
        @ms_next = 0
        @ms_segs = []
        @ms_inject = nil
      end

      def readyNextLine
        fresh = @scanner.nil? || @scanner.eos?
        ok = super
        if ok && fresh
          n = @line.bytesize
          @ms_segs = [[0, n, @ms_next, @ms_next + n, nil]]
          @ms_next += n
        end
        ok
      end

      def scan(re)
        from = @scanner.pos
        match = super
        @ms_owner.ms_lexeme(re, match, from, @scanner.pos, @ms_segs) if match
        match
      end

      # TaskJuggler rebuilds the line as <kept start> + text + <rest after the call> and puts the
      # cursor at the start of text; @ms_inject holds the segments of text.
      def injectText(text, callLength)
        segs = @ms_inject or raise 'token oracle: text injected without its segments'
        @ms_inject = nil
        old = @ms_segs
        post = @scanner.pos
        n = @line.bytesize
        super
        pre = @scanner.pos
        @ms_segs = Segments.slice(old, 0, pre) + Segments.shift(segs, pre) +
                   Segments.shift(Segments.slice(old, post, n), pre + text.bytesize)
      end

      # Byte offset in the scanned text where scanning stands; nil past the last line.
      def ms_cursor
        @scanner ? Segments.map_start(@ms_segs, @scanner.pos) : nil
      end
    end

    class OracleScanner < TaskJuggler::ProjectFileScanner
      ROLES = { newPos: :trivia, startComment: :comment_start, startMacroCall: :call_start,
                midMacroCall: :call, endMacroCall: :call, environmentVariable: :env }.freeze

      attr_reader :items, :calls

      def initialize(text)
        super(text)
        @ms_size = text.bytesize
        # Role of each pattern, by mode and pattern object (the same source text can serve
        # different roles in different modes).
        @ms_roles = @patternsByMode.to_h do |mode, patterns|
          roles = {}.compare_by_identity
          patterns.each do |_type, re, post|
            roles[re] = mode == :cppComment ? :comment : ROLES.fetch(post&.name, :token)
          end
          [mode, roles]
        end
        @items = [] # [kind, from, to, text, token fields or nil], byte offsets in the scanned text
        @calls = []
        @ws = @comment = @tok = @call = nil
      end

      def open(fileNameIsBuffer = false)
        super
        @cf.extend(LineMap)
        @cf.ms_attach(self)
      end

      def nextToken
        tok = super
        flush_ws
        emit(*tok) unless tok[0] == :eof
        tok
      end

      def ms_lexeme(re, match, from, to, segs)
        role = @ms_roles.fetch(@scannerMode).fetch(re)
        tf = Segments.map_start(segs, from)
        tt = Segments.map_end(segs, to)
        case role
        when :trivia
          if !WHITESPACE.match?(match)
            flush_ws
            @items << [:comment, tf, tt, match.dup, nil]
          elsif @ws
            @ws[2] = tt
            @ws[3] << match
          else
            @ws = [:whitespace, tf, tt, match.dup, nil]
          end
        when :comment_start
          flush_ws
          @comment = [:comment, tf, tt, match.dup, nil]
        when :comment
          @comment[2] = tt
          @comment[3] << match
        when :call_start, :env
          flush_ws
          @call = { segs: Segments.slice(segs, from, to), to: tt }
        when :call
          @call[:to] = tt
        else
          flush_ws
          @tok ||= { from: tf, text: +'', calls: [] }
          @tok[:to] = tt
          @tok[:text] << match
          @tok[:calls].concat(Segments.calls(segs, from, to))
        end
      end

      # Called by TaskJuggler's endMacroCall in place of the real expansion.
      def expandMacro(prefix, args, callLength)
        name = args[0]
        inject_call('macro', prefix, name.delete_prefix('?'), name.start_with?('?'), args[1..],
                    callLength)
      end

      # [id, message, line, from, to] for the error TaskJuggler just raised.
      def ms_error(msg)
        flush_ws
        cursor = @cf&.ms_cursor || @ms_size
        starts = [@tok && @tok[:from], @comment && @comment[1],
                  @call && Segments.map_start(@call[:segs], 0)].compact
        from = starts.min || cursor
        [msg&.id, msg&.message, msg&.sourceFileInfo&.lineNo, from, [cursor, from].max]
      end

      private

      def flush_ws
        @items << @ws if @ws
        @ws = nil
      end

      def emit(type, value, sfi)
        tok = @tok or raise "token oracle: #{type} returned without a match"
        @tok = nil
        @items << [:token, tok[:from], tok[:to], tok[:text],
                   { type: type.to_s, value: value, line: sfi&.lineNo, calls: tok[:calls].uniq }]
      end

      def endComment(type, match)
        res = super
        @items << @comment
        @comment = nil
        res
      end

      # TaskJuggler's own environmentVariable would read ENV; this one splices like a macro call.
      def environmentVariable(_type, match)
        start = match.index('$(')
        ref = match[start..]
        inject_call('env', match[0, start], ref[2..-2], false, [], ref.length)
        [nil, '']
      end

      def inject_call(kind, prefix, name, optional, args, length)
        call = @call or raise 'token oracle: macro call without its start'
        @call = nil
        pn = prefix.bytesize
        from = Segments.map_start(call[:segs], pn)
        @calls << { 'kind' => kind, 'from' => from, 'to' => call[:to], 'name' => name,
                    'optional' => optional, 'args' => args }
        placeholder = [pn, pn + 1, from, call[:to], @calls.size - 1]
        @cf.ms_inject = Segments.slice(call[:segs], 0, pn) + [placeholder]
        @cf.injectText(prefix + PLACEHOLDER, length)
      end
    end
  end
end
