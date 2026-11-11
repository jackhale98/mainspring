# SPDX-License-Identifier: GPL-2.0-or-later
#
# record.rb - native entry used only by engine/golden/record-native.mjs to
# produce golden outputs (docs/phases/phase-0.md, sections 3.4 and 6.2).
#
#   bundle exec ruby -I engine/tj/lib engine/bridge/native/record.rb \
#     --root <dir> --entry <path> [--now <iso>] [--id <id>] \
#     [--glob <pattern>]... [--workspace <dir>] [--timings-out <file>]
#
# It loads unmodified TaskJuggler from engine/tj/lib with the real gems from
# engine/golden/Gemfile.lock, plus the shared bridge code (request.rb and
# serialize.rb). It never loads engine/bridge/wasm/ or engine/stubs/.
#
# Request semantics match tj_bridge.rb because the code is shared: the files
# under --root that match the globs (default **/*.tjp and **/*.tji) become the
# request's `files`, read as bytes and decoded like the browser does (invalid
# UTF-8 -> U+FFFD, leading BOM dropped; see request.rb). They are written to a
# private workspace directory (a fresh temporary one, or --workspace, which is
# kept for the tj3 cross-check), and <workspace>/<entry> is parsed and
# scheduled, with --now applied only when the plan has no `now` line.
#
# Prints the GoldenFile as canonical JSON (keys sorted, 2-space indent,
# trailing newline) on stdout. --timings-out writes this run's timings.
require 'json'
require 'optparse'
require 'tmpdir'
require 'fileutils'
require 'taskjuggler/TaskJuggler'
require 'taskjuggler/Tj3Config'
require_relative '../request'

module MainspringRecord
  DEFAULT_GLOBS = ['**/*.tjp', '**/*.tji'].freeze
  PIN_FILE = File.expand_path('../../tj.pin.json', __dir__)

  module_function

  def options(argv)
    opts = { globs: [] }
    OptionParser.new do |o|
      o.on('--root DIR') { |v| opts[:root] = v }
      o.on('--entry PATH') { |v| opts[:entry] = v }
      o.on('--now ISO') { |v| opts[:now] = v }
      o.on('--id ID') { |v| opts[:id] = v }
      o.on('--glob PATTERN') { |v| opts[:globs] << v }
      o.on('--workspace DIR') { |v| opts[:workspace] = v }
      o.on('--timings-out FILE') { |v| opts[:timings] = v }
    end.parse!(argv)
    abort 'record.rb: --root and --entry are required' unless opts[:root] && opts[:entry]
    opts[:globs] = DEFAULT_GLOBS if opts[:globs].empty?
    opts
  end

  def collect(root, globs)
    paths = Dir.glob(globs, base: root).select { |p| File.file?(File.join(root, p)) }
    paths.uniq.sort.to_h do |p|
      MainspringBridge.check_path!(p, 'file path')
      [p, File.binread(File.join(root, p))]
    end
  end

  def tzdata
    dir = ENV['TZDIR'] || '/usr/share/zoneinfo'
    zi = File.join(dir, 'tzdata.zi')
    first = File.exist?(zi) ? File.open(zi, &:gets).to_s : ''
    first[/\A# version (\S+)/, 1] || 'unknown'
  end

  def gems
    unless defined?(Bundler) && Bundler.respond_to?(:locked_gems)
      abort 'record.rb: run under `bundle exec` with ' \
            'BUNDLE_GEMFILE=engine/golden/Gemfile'
    end
    Bundler.locked_gems.specs.map { |s| [s.name, s.version.to_s] }.uniq.sort.to_h
  end

  def native_info
    {
      'tjVersion' => AppConfig.version,
      'tjCommit' => JSON.parse(File.read(PIN_FILE)).fetch('commit'),
      'ruby' => RUBY_VERSION,
      'tzdata' => tzdata,
      'gems' => gems
    }
  end

  # Canonical JSON: object keys sorted, 2-space indent, empty containers as
  # {} and [], the layout of JS JSON.stringify(value, null, 2). (json 2.7's
  # pretty_generate prints empty arrays over several lines.) Floats use
  # Ruby's shortest round-trip form; record-native.mjs re-serializes the file
  # with JSON.stringify, so committed goldens use JS number formatting.
  def canonical_json(value, indent = '')
    inner = indent + '  '
    case value
    when Hash
      return '{}' if value.empty?

      body = value.keys.map(&:to_s).sort.map do |k|
        v = value.key?(k) ? value[k] : value[k.to_sym]
        "#{inner}#{JSON.generate(k)}: #{canonical_json(v, inner)}"
      end
      "{\n#{body.join(",\n")}\n#{indent}}"
    when Array
      return '[]' if value.empty?

      "[\n#{value.map { |v| inner + canonical_json(v, inner) }.join(",\n")}\n#{indent}]"
    else
      JSON.generate(value)
    end
  end

  def main(argv)
    opts = options(argv)
    root = File.realpath(opts[:root])
    files = collect(root, opts[:globs])
    MainspringBridge.validate!(files, opts[:entry])
    now = MainspringBridge.parse_now(opts[:now])

    keep = !opts[:workspace].nil?
    if keep && File.directory?(opts[:workspace]) && !Dir.empty?(opts[:workspace])
      abort "record.rb: --workspace #{opts[:workspace]} must be empty or absent"
    end
    ws = keep ? File.expand_path(opts[:workspace]) : Dir.mktmpdir('mainspring-ws-')
    FileUtils.mkdir_p(ws)
    ws = File.realpath(ws)
    begin
      MainspringBridge.write_workspace(ws, files)
      t0 = MainspringBridge.clock_ms
      result, timings = MainspringBridge.run(ws, opts[:entry], now)
      timings['totalMs'] = (MainspringBridge.clock_ms - t0).round(1)
    ensure
      FileUtils.rm_rf(ws) unless keep
    end

    golden = {
      'schemaVersion' => 1,
      'id' => opts[:id] || File.basename(opts[:entry], '.*'),
      'entry' => opts[:entry],
      'files' => files.keys.sort,
      'options' => { 'now' => opts[:now] },
      'native' => native_info,
      'result' => result
    }
    File.write(opts[:timings], JSON.generate(timings)) if opts[:timings]
    $stdout.write(canonical_json(golden) + "\n")
  rescue MainspringBridge::InvalidRequest => e
    abort "record.rb: invalid request: #{e.message}"
  end
end

MainspringRecord.main(ARGV) if $PROGRAM_NAME == __FILE__
