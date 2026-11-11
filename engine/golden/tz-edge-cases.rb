# SPDX-License-Identifier: GPL-2.0-or-later
#
# tz-edge-cases.rb - native side of the time-zone edge-case table
# (engine/golden/tz-edge-cases.json). Developer-only; run by
# `node engine/golden/tz-edges.mjs --native` and by record-native.mjs before
# it records, under `bundle exec` with TZ=UTC:
#
#   ruby -I engine/tj/lib engine/golden/tz-edge-cases.rb < input.json
#
# Reads { cases: [{ zone, local }], resolutions: [{ zone }] } on stdin and
# prints { cases: [{ zone, local, utc | error }], resolutions: [{ zone,
# maxMinutes | error }] }, in the same order. Each zone is set with
# TjTime.setTimeZone, which is what the `timezone` attribute does. A local
# time goes through TjTime.new(text), which is what the project file scanner
# does with a date token; a resolution cap is Project.maxScheduleGranularity,
# which the `timingresolution` attribute checks. Unmodified TaskJuggler; no
# bridge code.
require 'json'
require 'taskjuggler/TjTime'
require 'taskjuggler/Project'

def in_zone(zone, base)
  TaskJuggler::TjTime.setTimeZone(zone)
  base.merge(yield)
rescue StandardError => e
  base.merge('error' => "#{e.class}: #{e.message}")
ensure
  TaskJuggler::TjTime.setTimeZone('UTC')
end

input = JSON.parse($stdin.read)
cases = input['cases'].map do |c|
  in_zone(c['zone'], 'zone' => c['zone'], 'local' => c['local']) do
    { 'utc' => TaskJuggler::TjTime.new(c['local']).time.getutc.strftime('%Y-%m-%dT%H:%M:%SZ') }
  end
end
resolutions = input['resolutions'].map do |r|
  in_zone(r['zone'], 'zone' => r['zone']) do
    { 'maxMinutes' => TaskJuggler::Project.maxScheduleGranularity / 60 }
  end
end
puts JSON.generate('cases' => cases, 'resolutions' => resolutions)
