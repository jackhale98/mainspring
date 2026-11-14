# SPDX-License-Identifier: GPL-2.0-or-later
#
# fast-path-rule-walk.rb - the rule walk behind ADR-0010's "What can change the seven
# attributes" (the T19 review, round 3). It reads TaskJuggler's own parser tables, not the
# grammar file: it builds a ProjectFileParser, walks every rule reachable from the given rules
# through rule references, and prints each pattern action that assigns `@property[...]`, calls
# `set`, `reset`, `adopt` or `inheritAttributes`, touches `provided` or `forward`, or sets the
# scenario index or the current property. The fast path's checks (engine/bridge/fast_path.rb)
# must cover every action that changes one of the seven attributes, `forward` or `provided`;
# rerun this after any TaskJuggler update and compare with the ADR.
#
#   ruby tests/engine/fast-path-rule-walk.rb engine/tj/lib task supplementTask
#
# A developer tool: it runs native Ruby, schedules nothing, and is not part of the bundle.
$LOAD_PATH.unshift(File.expand_path(ARGV.shift))
require 'taskjuggler/TaskJuggler'
require 'taskjuggler/ProjectFileParser'

rules = TaskJuggler::ProjectFileParser.new.instance_variable_get(:@rules)
roots = ARGV.empty? ? %i[task supplementTask] : ARGV.map(&:to_sym)

seen = {}
queue = roots.dup
until queue.empty?
  name = queue.shift
  next if seen[name] || !rules[name]

  seen[name] = true
  rules[name].patterns.each do |pat|
    pat.tokens.each { |type, value| queue << value if type == :reference }
  end
end

READS = %w[get attributeDefinition parent fullId id leaf? container? kids name ptn is_a? class
           project sourceFileInfo].freeze
WRITE = Regexp.union(
  /@property\[[^\]]*\]\s*=[^=]/,
  /@property\.(?!(?:#{READS.map { |r| Regexp.escape(r) }.join('|')})(?![\w?!]))\w+/,
  /\.reset\b/, /provided/, /setDurationAttribute/, /'forward'/, /@scenarioIdx\s*=/,
  /inheritAttributes/, /instance_variable_set/, /@property\s*=/
)

# The lines of a pattern's action: from its `lambda {` to the `})` at the same indentation, or
# that one line when the lambda closes on it.
def action_lines(src, line)
  first = src[line - 1]
  return [[line, first]] if first =~ /lambda\s*\{.*\}\s*\)?\s*$/

  indent = first[/\A\s*/].length
  out = []
  i = line - 1
  while i < src.length
    out << [i + 1, src[i]]
    break if i > line - 1 && src[i] =~ /\A\s{#{indent}}\}\)/

    i += 1
  end
  out
end

files = {}
puts "#{seen.size} rules reachable from #{roots.join(', ')}"
seen.keys.sort.each do |name|
  rules[name].patterns.each do |pat|
    file, line = pat.function&.source_location
    next unless file

    hits = action_lines(files[file] ||= File.readlines(file), line).select { |_, l| l =~ WRITE }
    next if hits.empty?

    toks = pat.tokens.map do |t, v|
      { reference: "!#{v}", literal: "_#{v}" }.fetch(t, "$#{v}")
    end
    puts "#{name} [#{toks.join(' ')}] (#{File.basename(file)}:#{line})"
    hits.each { |n, l| puts "    #{n}: #{l.strip[0, 140]}" }
  end
end
