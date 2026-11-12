# SPDX-License-Identifier: GPL-2.0-only
# Instrumented copy of TaskJuggler's TextParser::Scanner#scanToken, from
# engine/tj/lib/taskjuggler/TextParser/Scanner.rb at 3b36c79.
#
# Dev-only token oracle for scripts/dev/scanner-diff.dev.ts (never run in CI or at runtime):
# runs TaskJuggler's own ProjectFileScanner on each buffer and reports every token with its
# type, start and end byte offsets and value. Macro calls are not supported (the caller skips
# buffers containing `${` or `$(`).
#
# Each buffer goes through `forceUTF8Encoding` first, as FileStreamHandle does for files (and so
# the wasm bridge, which writes files): `\r\n` and a lone `\r` become `\n`. Offsets refer to
# that normalised text; the caller maps them back.
#
# Usage: ruby -I engine/tj/lib scripts/dev/tj-tokens.rb < texts.json > tokens.json
#   texts.json:  ["text", ...]
#   tokens.json: [{"tokens": [[type, startByte, endByte, value], ...],
#                  "error": null | {"id": id, "at": startByte}}, ...]
require 'json'
require 'taskjuggler/UTF8String'
require 'taskjuggler/TjException'
require 'taskjuggler/MessageHandler'
require 'taskjuggler/Log'
require 'taskjuggler/TjTime'
require 'taskjuggler/ProjectFileScanner'

class ScanStop < StandardError
  attr_reader :id

  def initialize(id)
    @id = id
    super(id)
  end
end

class TaskJuggler::TextParser::Scanner::StreamHandle
  # Same as upstream, plus @base: the byte offset of the current line in the buffer.
  def readyNextLine
    if @scanner.nil? || @scanner.eos?
      @base = (@base || 0) + (@line && @scanner ? @line.bytesize : 0)
      unless (@line = @stream.gets)
        @scanner = nil
        return false
      end
      @scanner = StringScanner.new(@line)
      @wrapped = @line[-1] == ?\n
    end
    true
  end

  def absPos
    (@base || 0) + (@scanner ? @scanner.pos : 0)
  end
end

class TaskJuggler::TextParser::Scanner
  attr_reader :tokStart, :tokEnd

  # Stop at the first error instead of exiting.
  def error(id, _text, _sfi = nil, _data = nil)
    raise ScanStop.new(id)
  end

  # Upstream scanToken, recording where each token starts (after the last ignored match that
  # left the scanner in the default mode) and ends.
  def scanToken
    @startOfToken = sourceFileInfo
    @tokStart = @cf.absPos
    match = nil
    loop do
      unless @cf.readyNextLine
        error('runaway_token', 'runaway') if @scannerMode != @defaultMode
        @finishLastFile = true
        return [ :eof, '<END>', @startOfToken ]
      end
      @activePatterns.each do |type, re, postProc|
        next unless (match = @cf.scan(re))

        type, match = postProc.call(type, match) if postProc
        if type.nil?
          @tokStart = @cf.absPos if @scannerMode == @defaultMode
          break
        end
        @tokEnd = @cf.absPos
        return [ type, match, @startOfToken ]
      end
      error('no_token_match', 'no match') if match.nil?
    end
  end
end

texts = JSON.parse($stdin.read)
out = texts.map do |text|
  scanner = TaskJuggler::ProjectFileScanner.new(text.forceUTF8Encoding)
  scanner.open(true)
  tokens = []
  err = nil
  begin
    loop do
      tok = scanner.nextToken
      break if tok[0] == :eof || tok[0] == :endOfText

      value = tok[1].is_a?(String) ? tok[1] : tok[1].to_s
      tokens << [ tok[0].to_s, scanner.tokStart, scanner.tokEnd, value ]
    end
  rescue ScanStop => e
    err = { 'id' => e.id, 'at' => scanner.tokStart }
  rescue ArgumentError
    err = { 'id' => 'scan_encoding_error', 'at' => scanner.tokStart }
  end
  { 'tokens' => tokens, 'error' => err }
end
puts JSON.generate(out)
