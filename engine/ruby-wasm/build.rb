# SPDX-License-Identifier: GPL-2.0-or-later
# frozen_string_literal: true
#
# build.rb - build CRuby 3.4 for wasm32-wasip1 without the openssl extension (phase-4 T13).
#
# Run by engine/ruby-wasm/build.sh under `bundle exec` (Gemfile in this directory), never by hand
# without it: build.sh fetches and checks every input first. It drives the ruby_wasm 2.10.1
# packager, the same code that built `@ruby/3.4-wasm-wasi` 2.10.1 (the binary the app ships
# today), with four changes and nothing else:
#
# 1. The extension list is ruby_wasm's "3.4" full profile minus `openssl`.
# 2. The OpenSSL library is neither fetched nor built, and `--with-openssl-dir` is not passed
#    (ruby_wasm builds it unconditionally; with the extension gone nothing would link it, but a
#    build that never compiles it cannot ship it by accident).
# 3. Sources come from files build.sh verified (file:// URLs) instead of downloads during the
#    build: the Ruby tarball, LibYAML and zlib. LibYAML's config.guess and config.sub come from
#    the pinned Ruby tarball's tool/ directory instead of gcc's unpinned master branch.
# 4. Two kinds of files are not packed: the host-side build logs of gem extensions (they name
#    temporary paths, so two builds would differ) and rdoc's HTML generator templates (fonts,
#    icons and scripts for writing documentation sites, under their own licences; the engine
#    never loads rdoc).
#
# Guards: ruby_wasm fetches wasi-sdk, binaryen, wasi-vfs and OpenSSL itself when it is not given
# them. build.sh gives it each of them (checked against inputs.json) except OpenSSL, which the
# recipe drops, so the build raises if any of those code paths, or any other network fetch through
# ruby_wasm's executor, would run.
#
# Modes:
#   --vfs (default): the stock packager. The standard library and the gems in this Gemfile are
#     packed into the binary with wasi-vfs (LIB_WASI_VFS_A must name libwasi_vfs.a), giving a
#     drop-in replacement for dist/ruby.debug+stdlib.wasm. build.sh strips it to ruby+stdlib.wasm.
#   --no-vfs: no wasi-vfs. Writes the interpreter (bin/ruby, debug info kept) and, in --fs-dir,
#     the /usr and /bundle trees that wasi-vfs would have packed. For checking the interpreter
#     where wasi-vfs cannot be fetched; the engine needs those trees mounted to boot.
#
# Environment (set by build.sh): WASI_SDK_PATH, wasm-opt on PATH, LIB_WASI_VFS_A (--vfs only).
require "optparse"
require "fileutils"
require "json"
require "tmpdir"
require "ruby_wasm"
require "ruby_wasm/cli"

RUBY_WASM_VERSION = "2.10.1"
RUBY_SERIES = "3.4"
RUBY_TARBALL_URL = "https://cache.ruby-lang.org/pub/ruby/3.4/ruby-3.4.1.tar.gz"
DROPPED_EXTS = %w[openssl].freeze
TARGET = "wasm32-unknown-wasip1"

def fail!(message)
  warn "build.rb: #{message}"
  exit 1
end

opts = { vfs: true }
OptionParser.new do |o|
  o.banner = "usage: build.rb --root DIR --ruby-tarball F --libyaml-tarball F --zlib-tarball F --output F [--no-vfs --fs-dir DIR]"
  o.on("--root DIR", "Work directory (build/ and rubies/ go here)") { |v| opts[:root] = File.expand_path(v) }
  o.on("--ruby-tarball FILE") { |v| opts[:ruby] = File.expand_path(v) }
  o.on("--libyaml-tarball FILE") { |v| opts[:libyaml] = File.expand_path(v) }
  o.on("--zlib-tarball FILE") { |v| opts[:zlib] = File.expand_path(v) }
  o.on("--output FILE", "The built wasm, debug info kept") { |v| opts[:output] = File.expand_path(v) }
  o.on("--fs-dir DIR", "With --no-vfs, where to write the usr/ and bundle/ trees") { |v| opts[:fs_dir] = File.expand_path(v) }
  o.on("--[no-]vfs", "Pack the stdlib with wasi-vfs (default)") { |v| opts[:vfs] = v }
  o.on("--exts-file FILE", "Write the extension list here") { |v| opts[:exts_file] = File.expand_path(v) }
end.parse!

%i[root ruby libyaml zlib output].each { |k| fail!("--#{k.to_s.tr('_', '-')} is required") unless opts[k] }
%i[ruby libyaml zlib].each { |k| fail!("#{opts[k]} not found") unless File.file?(opts[k]) }
fail!("--fs-dir is required with --no-vfs") if !opts[:vfs] && !opts[:fs_dir]
fail!("ruby_wasm #{RubyWasm::VERSION} is loaded, expected #{RUBY_WASM_VERSION}") unless RubyWasm::VERSION == RUBY_WASM_VERSION
# The packer (RubyWasmExt::WasiVfs) is in ruby_wasm's native extension, which rbwasm loads in its
# CLI (RubyWasm::CLI#require_extension), not on `require "ruby_wasm"`. Load it the same way.
RubyWasm::CLI.new(stdout: $stdout, stderr: $stderr).send(:require_extension)
fail!("ruby_wasm's native extension did not define RubyWasmExt::WasiVfs") unless defined?(RubyWasmExt::WasiVfs)
fail!("WASI_SDK_PATH is not set") unless ENV["WASI_SDK_PATH"]
fail!("wasm-opt is not on PATH") unless RubyWasm::Toolchain.find_path("wasm-opt")
if opts[:vfs]
  lib = ENV["LIB_WASI_VFS_A"]
  fail!("--vfs needs LIB_WASI_VFS_A (libwasi_vfs.a)") unless lib && File.file?(lib)
else
  ENV.delete("LIB_WASI_VFS_A")
end
%w[RUBY_WASM_EXPERIMENTAL_DYNAMIC_LINKING RUBY_WASM_EXPERIMENTAL_COMPONENT_MODEL RUBY_WASM_ADDITIONAL_EXTS].each do |k|
  fail!("#{k} must not be set: the recipe builds the static, non-component flavour only") if ENV[k] && !ENV[k].empty?
end

# --- 1. The build config: ruby_wasm's own "3.4" alias, minus openssl, from the verified tarball.
alias_config = RubyWasm::CLI.build_config_aliases(opts[:root]).fetch(RUBY_SERIES)
unless alias_config[:src][:type] == "tarball" && alias_config[:src][:url] == RUBY_TARBALL_URL
  fail!("ruby_wasm's #{RUBY_SERIES} source is #{alias_config[:src].inspect}, expected #{RUBY_TARBALL_URL}")
end
unless alias_config[:src][:patches].empty?
  fail!("ruby_wasm #{RUBY_WASM_VERSION} applies patches #{alias_config[:src][:patches].inspect}; review them first")
end
stock_exts = alias_config.fetch(:all_default_exts).split(",")
missing = DROPPED_EXTS - stock_exts
fail!("the stock extension list has no #{missing.join(', ')}; review DROPPED_EXTS") unless missing.empty?
exts = stock_exts - DROPPED_EXTS
config = {
  name: RUBY_SERIES,
  src: alias_config[:src].merge(url: "file://#{opts[:ruby]}"),
  wasi_sdk_version: alias_config[:wasi_sdk_version],
  target: TARGET,
  default_exts: exts.join(","),
  suffix: "-full-no-openssl"
}
File.write(opts[:exts_file], JSON.pretty_generate({ "stock" => stock_exts, "built" => exts, "dropped" => DROPPED_EXTS }) + "\n") if opts[:exts_file]

# Settings for the patches below. Not ENV: ruby_wasm runs the build inside
# Bundler.with_unbundled_env, which restores the environment Bundler started with.
MAINSPRING = {
  no_vfs: !opts[:vfs],
  libyaml_tarball: opts[:libyaml],
  zlib_tarball: opts[:zlib],
  # The Ruby source directory the packager unpacks the tarball into (BuildSource#src_dir).
  ruby_src: File.join(opts[:root], "build", "checkouts", RUBY_SERIES)
}.freeze

# --- 2. No OpenSSL product; no wasi-vfs in --no-vfs.
module MainspringNoOpenSSL
  def initialize(*args, **kwargs)
    super
    @crossruby.with_openssl(nil)
    @crossruby.with_wasi_vfs(nil) if MAINSPRING[:no_vfs]
  end
end
RubyWasm::Build.prepend(MainspringNoOpenSSL)

# --- 3. LibYAML and zlib from the verified tarballs. These are ruby_wasm 2.10.1's own build
# methods (lib/ruby_wasm/build/product/{libyaml,zlib}.rb) with the downloads replaced.
module MainspringLocalSources
  def self.ruby_tool_dir = File.join(MAINSPRING[:ruby_src], "tool")

  def self.unpack(executor, tarball, dir)
    executor.mkdir_p File.dirname(dir)
    executor.rm_rf dir
    executor.mkdir_p dir
    executor.system "tar", "xzf", tarball, "-C", dir, "--strip-components=1"
  end
end

module MainspringLibYAML
  def build(executor)
    return if Dir.exist?(install_root)
    MainspringLocalSources.unpack(executor, MAINSPRING[:libyaml_tarball], product_build_dir)
    %w[config.guess config.sub].each do |f|
      executor.cp_r File.join(MainspringLocalSources.ruby_tool_dir, f), File.join(product_build_dir, "config", f)
    end
    args = configure_args.dup
    args << "CFLAGS=-fPIC" if target.pic?
    executor.system "./configure", *args, chdir: product_build_dir
    executor.system "make", "install", "DESTDIR=#{destdir}", chdir: product_build_dir
  end
end
RubyWasm::LibYAMLProduct.prepend(MainspringLibYAML)

module MainspringZlib
  def build(executor)
    return if Dir.exist?(install_root)
    MainspringLocalSources.unpack(executor, MAINSPRING[:zlib_tarball], product_build_dir)
    args = configure_args.dup
    args << "CFLAGS=-fPIC" if target.pic?
    executor.system "env", *args, "./configure", "--static", chdir: product_build_dir
    executor.system "make", "install", "DESTDIR=#{destdir}", chdir: product_build_dir
  end
end
RubyWasm::ZlibProduct.prepend(MainspringZlib)

# --- 4. Files that are not packed, through the packager's own hook for non-runtime files (both
# modes call it).
# - The host-side install logs of the gems' extensions (gem_make.out, mkmf.log) name temporary
#   directories and process ids, so /bundle would not be reproducible. Nothing reads them.
# - rdoc's generator templates (rdoc/generator/template: darkfish's Lato and Source Code Pro fonts
#   under OFL-1.1, its icons and scripts, json_index's scripts). Only rdoc's HTML generator reads
#   them, to write a documentation site; the engine never requires rdoc (run-engine.mjs lists
#   $LOADED_FEATURES). rdoc's Ruby code stays.
module MainspringNonRuntimeFiles
  RDOC_TEMPLATES = File.join("usr", "local", "lib", "ruby", "**", "rdoc", "generator", "template")

  def remove_non_runtime_files(executor)
    super
    Dir.glob(File.join(@dest_dir, "bundle", "extensions", "**", "{gem_make.out,mkmf.log}")).each { |f| executor.rm_f f }
    templates = Dir.glob(File.join(@dest_dir, RDOC_TEMPLATES))
    raise "build.rb: no rdoc generator templates under #{@dest_dir}; review MainspringNonRuntimeFiles" if templates.empty?
    templates.each do |dir|
      files = Dir.glob(File.join(dir, "**", "*")).select { |f| File.file?(f) }
      RubyWasm.logger.info "Not packing #{dir.delete_prefix(@dest_dir)}: #{files.size} files, #{files.sum { |f| File.size(f) }} bytes"
      executor.rm_rf dir
    end
  end
end
RubyWasm::Packager::FileSystem.prepend(MainspringNonRuntimeFiles)

# --- Guards: no download by ruby_wasm itself. build.sh fetches and checks every input; these
# raise where ruby_wasm 2.10.1 would fetch one on its own (lib/ruby_wasm/build/toolchain.rb,
# build/product/{wasi_vfs,openssl}.rb), so a gem bump or a missing variable cannot bring in an
# unpinned tool or library unnoticed.
module MainspringNoFetch
  def self.refuse!(what, instead = "build.sh must provide it, pinned in inputs.json")
    raise "build.rb: ruby_wasm would fetch #{what} itself; #{instead}"
  end

  # wasi-sdk: fetched when WASI_SDK_PATH is not set.
  module WasiSdk
    def install_wasi_sdk(executor)
      MainspringNoFetch.refuse!("wasi-sdk") if @need_fetch_wasi_sdk
      super
    end

    def download_url(*) = MainspringNoFetch.refuse!("wasi-sdk")
  end

  # binaryen: fetched when no wasm-opt is on PATH.
  module Binaryen
    def install(executor)
      MainspringNoFetch.refuse!("binaryen") if @need_fetch_binaryen
      super
    end

    def download_url(*) = MainspringNoFetch.refuse!("binaryen")
  end

  # wasi-vfs: fetched when LIB_WASI_VFS_A is not set and the product is built (--vfs only).
  module WasiVfs
    def build(executor)
      MainspringNoFetch.refuse!("wasi-vfs (libwasi_vfs.a)") if @need_fetch_lib
      super
    end
  end

  # OpenSSL: fetched and built whenever the product is built; patch 2 removes the product.
  module OpenSSLLibrary
    def build(*) = MainspringNoFetch.refuse!("and build OpenSSL", "this recipe links no OpenSSL (patch 2)")
  end

  # Anything else through ruby_wasm's executor: curl of anything but a file:// URL, git, wget, or
  # Ruby's tool/downloader.rb (BuildSource runs it when a source tree has no configure script).
  module Executor
    def system(*args, **kwargs)
      argv = args.flatten.map(&:to_s)
      command = File.basename(argv.first.to_s)
      url = argv.find { |a| a.match?(%r{\A[a-z][a-z0-9+.-]*://}i) && !a.start_with?("file://") }
      MainspringNoFetch.refuse!(url) if command == "curl" && url
      MainspringNoFetch.refuse!("with #{command} (#{argv.join(' ')})") if %w[git wget].include?(command)
      MainspringNoFetch.refuse!("config.guess and config.sub (tool/downloader.rb)") if argv.any? { |a| a.end_with?("tool/downloader.rb") }
      super
    end
  end
end
RubyWasm::WASISDK.prepend(MainspringNoFetch::WasiSdk)
RubyWasm::Binaryen.prepend(MainspringNoFetch::Binaryen)
RubyWasm::WasiVfsProduct.prepend(MainspringNoFetch::WasiVfs)
RubyWasm::OpenSSLProduct.prepend(MainspringNoFetch::OpenSSLLibrary)
RubyWasm::BuildExecutor.prepend(MainspringNoFetch::Executor)

# --- Build.
definition = Bundler.definition
features = RubyWasm::FeatureSet.derive_from_env
packager = RubyWasm::Packager.new(opts[:root], config, definition, features: features)
specs = packager.specs.map(&:full_name).sort
RubyWasm.logger.info "Extensions: #{exts.join(',')}"
RubyWasm.logger.info "Gems packed into /bundle: #{specs.join(', ')}"
executor = RubyWasm::BuildExecutor.new(verbose: ENV["MAINSPRING_VERBOSE"] == "1")
build_opts = { stdlib: true, without_stdlib_components: [], remake: false, reconfigure: false, clean: false }

Dir.mktmpdir("ruby-wasm-fs") do |tmp|
  if opts[:vfs]
    wasm = packager.package(executor, tmp, build_opts)
  else
    # Packager#package without the wasi-vfs step: the same file system, written out instead.
    core = packager.ruby_core_build
    tarball = core.build(executor, build_opts)
    fs = RubyWasm::Packager::FileSystem.new(tmp, packager)
    fs.package_ruby_root(tarball, executor)
    wasm = File.binread(File.join(fs.ruby_root, "bin", "ruby"))
    fs.package_gems
    fs.remove_non_runtime_files(executor)
    FileUtils.rm_rf(opts[:fs_dir])
    FileUtils.mkdir_p(opts[:fs_dir])
    FileUtils.cp_r(File.join(tmp, "usr"), opts[:fs_dir])
    FileUtils.cp_r(File.join(tmp, "bundle"), opts[:fs_dir]) if Dir.exist?(File.join(tmp, "bundle"))
  end
  FileUtils.mkdir_p(File.dirname(opts[:output]))
  File.binwrite(opts[:output], wasm)
  RubyWasm.logger.info "Wrote #{opts[:output]} (#{wasm.bytesize} bytes)"
end
