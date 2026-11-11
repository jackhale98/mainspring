# SPDX-License-Identifier: GPL-2.0-or-later
#
# tz-edge-cases.rb - native side of the DST edge-case table
# (engine/golden/tz-edge-cases.json). Developer-only; run by
# `node engine/golden/tz-edges.mjs --native` and by record-native.mjs before
# it records, under `bundle exec` with TZ=UTC:
#
#   ruby -I engine/tj/lib engine/golden/tz-edge-cases.rb < cases.json
#
# Reads the cases (a JSON array of { zone, local }) on stdin and prints a JSON
# array of { zone, local, utc } or { zone, local, error }, in the same order.
# Each local time goes through TaskJuggler's own date parsing,
# TjTime.new(text), which is what the project file scanner does with a date
# token, after TjTime.setTimeZone(zone), which is what the `timezone`
# attribute does. Unmodified TaskJuggler; no bridge code.
require 'json'
require 'taskjuggler/TjTime'

results = JSON.parse($stdin.read).map do |c|
  TaskJuggler::TjTime.setTimeZone(c['zone'])
  time = TaskJuggler::TjTime.new(c['local']).time
  { 'zone' => c['zone'], 'local' => c['local'], 'utc' => time.getutc.strftime('%Y-%m-%dT%H:%M:%SZ') }
rescue StandardError => e
  { 'zone' => c['zone'], 'local' => c['local'], 'error' => "#{e.class}: #{e.message}" }
ensure
  TaskJuggler::TjTime.setTimeZone('UTC')
end
puts JSON.generate(results)
