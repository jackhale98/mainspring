# SPDX-License-Identifier: GPL-2.0-or-later
#
# tokens.rb (native) - native entry of the token oracle (../tokens.rb), used only by
# engine/golden/check-tokens.mjs to show that native Ruby and the browser engine give the same
# token streams. Developer-only: CI never runs it, and it is not part of the browser bundle.
#
#   bundle exec ruby -W0 -EUTF-8 -I engine/tj/lib engine/bridge/native/tokens.rb < request.json
#
# Reads { "files": { NAME: text } } from stdin; the caller has already decoded each file as the
# browser does, so both sides scan exactly the same text. Prints
# { "ruby": RUBY_VERSION, "results": { NAME: result } } on stdout, where each result is what
# TJBridge.tokens returns for that text. It loads unmodified TaskJuggler with the recorder's gems
# (engine/golden/Gemfile), never engine/bridge/wasm/ or engine/stubs/.
require 'json'
require_relative '../tokens'

request = JSON.parse($stdin.read)
results = request.fetch('files').to_h { |name, text| [name, MainspringBridge::Tokens.scan(text)] }
$stdout.write(JSON.generate({ 'ruby' => RUBY_VERSION, 'results' => results }))
