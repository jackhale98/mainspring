# SPDX-License-Identifier: GPL-2.0-or-later
#
# tokens.rb - the token oracle (docs/phases/phase-1.md, sections 5.1 and 6.9, task T19).
# It runs TaskJuggler's own ProjectFileScanner over one buffer and returns every token the
# scanner produces, with its offsets in that buffer, so that the TypeScript port of the scanner
# (src/lib/tjp/grammar/scanner.ts and scanner-core.ts) can be checked against it. Test only: the browser worker never
# calls it. TJBridge.tokens (tj_bridge.rb) requires this file on first use; natively,
# engine/bridge/native/tokens.rb does (engine/golden/check-tokens.mjs).
#
#   MainspringBridge::Tokens.scan(text) -> Hash      MainspringBridge::Tokens.json(text) -> String
#
# The scanner runs unmodified. A subclass of ProjectFileScanner (token_scanner.rb) watches every
# match through its stream handle and post-processing hooks; it changes no pattern, no mode and
# no pattern order. What the oracle does around it:
#
# - Input. The text is scanned the way TaskJuggler scans a workspace file: invalid UTF-8 becomes
#   U+FFFD, one leading U+FEFF is dropped (as the bridge drops it, request.rb), and CRLF and CR
#   become LF through TaskJuggler's own String#forceUTF8Encoding (FileStreamHandle applies it; a
#   plain buffer scan would not). All offsets refer to the text as given.
# - No macro is expanded and no environment variable is read. TaskJuggler's scanner splices the
#   expansion of a `${...}` call (or `$(NAME)` reference), after the call's glued prefix, back
#   into the line and scans on. The oracle splices in the prefix and one `_` instead, so the call
#   reads like a defined macro whose text is a word: `t${major}` and `${content}${major}` become
#   one ID, `"${title} x"` stays one STRING. The token whose text holds the `_` lists the call
#   in `macros`. (TaskJuggler itself drops an undefined `${?x}` together with its prefix; the
#   oracle cannot know which macros are defined, so it never does.)
# - Date values are read in UTC, and the previous time zone is restored afterwards.
#
# Result (JSON):
#   { "units": "utf16", "tokens": [Item...], "scanError": null | ScanError }
#
#   Item, in text order. The items tile the text from 0 to scanError.from, or to its end.
#     kind    "token" | "whitespace" | "comment" | "bom"
#     from,to offsets in the given text in UTF-16 code units (JavaScript string indices, as
#             Lezer and CodeMirror count them); `to` is exclusive
#     text    what the scanner read: text[from...to] with CRLF and CR as LF and each macro call
#             (MacroRef from...to) as one `_`
#   Items of kind "token" also have:
#     type    TaskJuggler's token type: ID, ABSOLUTE_ID, ID_WITH_COLON, DATE, TIME, FLOAT,
#             INTEGER, STRING, MACRO or LITERAL
#     value   TaskJuggler's value: the string for STRING (quotes, escapes and cut-here
#             indentation removed) and MACRO (the body), without the colon for ID_WITH_COLON;
#             a number for INTEGER and FLOAT; seconds since midnight for TIME; epoch seconds
#             for DATE (read in UTC unless the date has its own offset); otherwise the text
#     line    the token's line as TaskJuggler reports it (its SourceFileInfo)
#     macros  [MacroRef...], the calls inside this token in order; usually []
#   MacroRef: { kind: "macro" | "env", from, to, name, optional, args }
#     from...to covers `${` to `}` (or `$(` to `)`), without the prefix; name has no `?`;
#     optional is true for `${?name}`; args are the quoted call arguments, unescaped.
#   ScanError: { id, message, line, from, to }
#     TaskJuggler's message id, text and line (runaway_token, junk_after_cut, time_error, ...);
#     from is where the unfinished token, comment or call starts, to is where scanning stopped
#     (the end of the text for runaway_token). No items follow it.
#
# How the scanner's modes appear:
# - Whitespace: one item per run. TaskJuggler matches `\s+` (ASCII only) line by line.
# - Comments: `#` and `//` comments include their line break (`#.*\n?`); a one-line `/* */` is
#   greedy to the last `*/` on its line; a multi-line comment is one item from `/*` to the last
#   `*/` on its closing line. TaskJuggler moves a token's start line only past whitespace and
#   one-line comments, so a token directly after a multi-line comment's `*/` gets the
#   comment's first line.
# - Strings: one STRING from the opening quote, or `-8<-`, to the closing quote, or `->8-`,
#   across lines. A cut-here STRING's line is the line after `-8<-`.
# - MACRO (`[...]`): from `[` through the `]` and the line break after it.
# - A scanner error ends the scan; the parser's errors (unexpected tokens) are not scanner
#   errors and never appear here.
require 'json'
require 'taskjuggler/TaskJuggler'
require_relative 'token_scanner'

module MainspringBridge
  module Tokens
    BOM = "\uFEFF"

    module_function

    def json(text)
      JSON.generate(scan(text))
    end

    def scan(text)
      raw = text.to_s.dup.force_encoding(Encoding::UTF_8)
      raw = raw.scrub("\uFFFD") unless raw.valid_encoding?
      bom = raw.start_with?(BOM) ? BOM.bytesize : 0
      body = raw.byteslice(bom..)
      source = body.forceUTF8Encoding
      crlf = crlf_positions(body)
      unless source.bytesize == body.bytesize - crlf.size
        raise 'token oracle: line-end clean-up changed more than CRLF'
      end

      items, calls, error = with_utc { run_scanner(source) }
      offsets = Offsets.new(raw, bom, crlf)
      out = bom.zero? ? [] : [{ 'kind' => 'bom', 'from' => 0, 'to' => 1, 'text' => BOM }]
      items.each { |item| out << item_json(item, calls, offsets) }
      { 'units' => 'utf16', 'tokens' => out, 'scanError' => error && error_json(error, offsets) }
    end

    # Positions in source (after the clean-up) of the LFs that were CRLF in body.
    def crlf_positions(body)
      out = []
      pos = 0
      while (i = body.byteindex("\r\n", pos))
        out << i - out.size
        pos = i + 2
      end
      out
    end

    def with_utc
      env = ENV.fetch('TZ', nil)
      tz = TaskJuggler::TjTime.class_variable_get(:@@tz)
      ENV['TZ'] = 'UTC'
      TaskJuggler::TjTime.class_variable_set(:@@tz, 'UTC')
      yield
    ensure
      env.nil? ? ENV.delete('TZ') : ENV['TZ'] = env
      TaskJuggler::TjTime.class_variable_set(:@@tz, tz)
    end

    def run_scanner(source)
      mh = TaskJuggler::MessageHandlerInstance.instance
      quiet(mh)
      scanner = OracleScanner.new(source)
      scanner.open(true)
      error = nil
      begin
        loop { break if scanner.nextToken[0] == :eof }
      rescue TaskJuggler::TjRuntimeError, TaskJuggler::TjException
        error = scanner.ms_error(mh.messages.reverse.find { |m| m.type == :error })
      end
      [scanner.items, scanner.calls, error]
    ensure
      scanner&.close
      quiet(mh)
    end

    # No messages, nothing printed, and errors raise TjRuntimeError instead of exiting.
    def quiet(mh)
      mh.reset
      mh.outputLevel = :none
      mh.trapSetup = true
    end

    def item_json(item, calls, offsets)
      kind, from, to, text, tok = item
      h = { 'kind' => kind.to_s, 'from' => offsets[from], 'to' => offsets[to], 'text' => text }
      return h unless tok

      h['type'] = tok[:type]
      h['value'] = tok[:value].is_a?(TaskJuggler::TjTime) ? tok[:value].to_i : tok[:value]
      h['line'] = tok[:line]
      h['macros'] = tok[:calls].map do |i|
        calls[i].merge('from' => offsets[calls[i]['from']], 'to' => offsets[calls[i]['to']])
      end
      h
    end

    def error_json(error, offsets)
      id, message, line, from, to = error
      { 'id' => id, 'message' => message, 'line' => line,
        'from' => offsets[from], 'to' => offsets[to] }
    end

    # Byte offsets in the scanned text -> UTF-16 offsets in the text as given.
    class Offsets
      def initialize(raw, bom, crlf)
        @raw = raw
        @bom = bom
        @crlf = crlf
        @ascii = raw.ascii_only?
        @memo = {}
      end

      def [](pos)
        @memo[pos] ||= begin
          byte = @bom + pos + (@crlf.bsearch_index { |c| c >= pos } || @crlf.size)
          @ascii ? byte : utf16(byte)
        end
      end

      private

      # UTF-16 code units before raw byte offset _byte_, from a table of every character
      # boundary that is built on first use.
      def utf16(byte)
        @table ||= build_table
        @table.fetch(byte)
      end

      def build_table
        table = { 0 => 0 }
        bytes = 0
        units = 0
        @raw.each_char do |ch|
          bytes += ch.bytesize
          units += ch.ord > 0xFFFF ? 2 : 1
          table[bytes] = units
        end
        table
      end
    end
  end
end
