# SPDX-License-Identifier: GPL-2.0-or-later
# frozen_string_literal: true
#
# gem-licenses.rb - the licences of the Ruby gems a ruby.wasm build packs (phase-4 T13).
#
#   ruby engine/ruby-wasm/gem-licenses.rb <fs-dir> [--specs DIR] [--json FILE]
#
# <fs-dir> is the file system wasi-vfs packs into ruby+stdlib.wasm (build.sh --no-vfs writes it
# as out/fs): the default and bundled gems of usr/local/lib/ruby/gems/*/specifications (and their
# default/ subdirectory), plus the gems of bundle/ (this Gemfile's). Bundler's standalone layout
# keeps no specification in bundle/, so those are read from --specs (the specifications directory
# of build.sh's `bundle install`, <work>/bundle-app/vendor/bundle/ruby/*/specifications) or from a
# <name>.gemspec inside the gem. Prints one line per gem with its declared licences and exits 1 if
# any declares none, or only ones outside ALLOWED (GPL-2.0 compatible, ADR-0001). The Ruby standard
# library outside gems is CRuby's own (Ruby OR BSD-2-Clause, see Ruby's LEGAL); not listed here.
require "json"
require "rubygems"

# "Ruby" is the Ruby licence, whose text itself offers the 2-clause BSD licence as an alternative.
ALLOWED = %w[
  Ruby BSD-2-Clause BSD-3-Clause MIT ISC 0BSD Zlib Unlicense CC0-1.0 Python-2.0 PSF-2.0
  GPL-2.0 GPL-2.0-only GPL-2.0-or-later LGPL-2.1 LGPL-2.1-only LGPL-2.1-or-later
].freeze
# RubyGems lists alternatives (OR) in `licenses`, so one allowed entry is enough.
def ok?(licenses) = licenses.any? { |l| ALLOWED.include?(l) }

dir = ARGV.fetch(0) { abort "usage: gem-licenses.rb <fs-dir> [--specs DIR] [--json FILE]" }
json_out = ARGV.index("--json") && ARGV[ARGV.index("--json") + 1]
specs_dir = ARGV.index("--specs") && ARGV[ARGV.index("--specs") + 1]
specs = Dir[File.join(dir, "usr/local/lib/ruby/gems/*/specifications/{,default/}*.gemspec")]
rows = specs.sort.map do |file|
  spec = Gem::Specification.load(file) or abort "cannot load #{file}"
  kind = file.include?("/default/") ? "default" : "bundled"
  { "gem" => spec.full_name, "kind" => kind, "licenses" => spec.licenses, "ok" => ok?(spec.licenses) }
end
Dir[File.join(dir, "bundle/gems/*")].sort.each do |gem_dir|
  name = File.basename(gem_dir)
  candidates = []
  candidates << File.join(specs_dir, "#{name}.gemspec") if specs_dir
  candidates << File.join(gem_dir, "#{name.sub(/-[^-]+\z/, '')}.gemspec")
  file = candidates.find { |f| File.file?(f) }
  spec = file && Dir.chdir(File.dirname(file)) { Gem::Specification.load(file) }
  licenses = spec ? spec.licenses : []
  rows << { "gem" => name, "kind" => "bundle", "licenses" => licenses, "ok" => spec ? ok?(licenses) : nil }
end
rows.each do |r|
  mark = r["ok"].nil? ? "? (no specification)" : (r["ok"] ? "ok" : "NOT ALLOWED")
  puts format("%-8s %-36s %-30s %s", r["kind"], r["gem"], r["licenses"].join(" OR "), mark)
end
File.write(json_out, JSON.pretty_generate(rows) + "\n") if json_out
bad = rows.reject { |r| r["ok"] }
puts "#{rows.size} gems, #{bad.size} without an allowed licence#{bad.empty? ? '' : ': ' + bad.map { |r| r['gem'] }.join(', ')}"
exit(bad.empty? ? 0 : 1)
