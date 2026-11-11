# SPDX-License-Identifier: GPL-2.0-or-later
#
# syntax.rb - SyntaxDocs (docs/phases/phase-0.md, section 3.1) from
# TaskJuggler's own keyword documentation: TaskJuggler::SyntaxReference, the
# class behind `tj3man`, walks the project file parser's rules. Every keyword,
# syntax line, context, scenario flag and "see also" therefore comes from
# engine/tj unchanged; this file only reshapes it. Deprecated and removed
# keywords are left out (SyntaxReference's ignoreOld).
#
# KeywordDoc fields:
#   keyword          unique keyword, scoped where TaskJuggler scopes it
#                    ("dailymax", "booking.task")
#   contexts         keywords it can appear in, sorted ([] = global scope)
#   syntax           TaskJuggler's syntax line, e.g.
#                    "dailymax <value> (min | h | d | w | m | y) [{ <attributes> }]"
#   doc              the documentation rendered from RichText to plain text by
#                    TaskJuggler's RichText code, paragraphs separated by a
#                    blank line and not wrapped
#   summary          the first sentence of doc
#   scenarioSpecific whether the attribute is scenario specific
#   seeAlso          related keywords, sorted
#
# Shared code: needs no wasm patch, so it also loads on native Ruby. The
# browser bridge (tj_bridge.rb) requires it lazily on the first `syntax`
# request. Building it constructs a ProjectFileParser and rebuilds its parser
# tables; in the browser that is the cached parser (wasm/tj_parser_cache.rb),
# which restores its pristine tables on the next parse.
require 'taskjuggler/SyntaxReference'
require 'taskjuggler/version'

module MainspringBridge
  module SyntaxDocs
    # Wide enough that RichText never wraps a paragraph.
    LINE_WIDTH = 100_000
    # A sentence ends at . ! or ? followed by space and a capital letter, so
    # "e.g. the" and "3.5d" do not end one.
    FIRST_SENTENCE = /\A(.+?[.!?])(?=\s+[A-Z]|\s*\z)/m.freeze

    module_function

    def build
      ref = TaskJuggler::SyntaxReference.new(nil, true)
      keywords = ref.keywords.keys.sort.map { |k| keyword(ref.keywords[k]) }
      { 'tjVersion' => ::VERSION, 'keywords' => keywords }
    end

    def keyword(kwd)
      doc = render(kwd.pattern.doc)
      {
        'keyword' => kwd.keyword,
        'contexts' => kwd.contexts.map(&:keyword).uniq.sort,
        # KeywordDocumentation keeps the syntax line without a reader.
        'syntax' => kwd.instance_variable_get(:@syntax).to_s,
        'summary' => summary(doc),
        'doc' => doc,
        'scenarioSpecific' => kwd.scenarioSpecific ? true : false,
        'seeAlso' => kwd.pattern.seeAlso.uniq.sort
      }
    end

    # RichText markup to plain text, as `tj3man` prints it but unwrapped.
    def render(text)
      return '' if text.nil? || text.empty?

      rti = TaskJuggler::RichText.new(text, []).generateIntermediateFormat
      return text.strip unless rti

      rti.lineWidth = LINE_WIDTH
      rti.to_s.strip
    rescue TaskJuggler::TjException
      text.strip
    end

    def summary(doc)
      para = doc.split(/\n\s*\n/).first.to_s.gsub(/\s+/, ' ').strip
      m = FIRST_SENTENCE.match(para)
      m ? m[1] : para
    end
  end
end
