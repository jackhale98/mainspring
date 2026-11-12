# SPDX-License-Identifier: GPL-2.0-or-later
#
# tz-patch-sweep.rb - developer-only check of engine/bridge/wasm/tj_wasm_tz.rb
# against native Ruby, far wider than tz-edge-cases.json. Needs Ruby on glibc
# and zdump (Debian/Ubuntu: libc-bin); no gems, no TaskJuggler. CI never runs it.
#
#   ruby engine/golden/tz-patch-sweep.rb [FROM_YEAR [TO_YEAR [ZONE...]]]
#
# It loads the patch into native Ruby with a stub JS host whose offsets come
# from glibc (as the browser's come from Intl), keeping native Time.local as
# the patch's own __tj_utc_local. For every zone in tzdata.zi (or the ZONEs
# given) and every offset change from FROM_YEAR to TO_YEAR (default 1970 to
# 2037), it compares the patched and native Time.local (instant, UTC offset
# and hour) for every quarter hour from 3 hours before the change's earlier
# wall time to 3 hours after its later one, plus both wall times exactly.
#
# A difference is explained when its change is off a 15-minute UTC boundary
# (the patch's offset cache cannot see it) or is an overlap longer than two
# hours (native Ruby looks only two hours ahead for the later instant). It
# prints the counts and up to 20 unexplained differences, and exits 1 if
# there are any. The patch's cache persists across zones, as in the browser.
require 'time'

PATCH = File.expand_path('../bridge/wasm/tj_wasm_tz.rb', __dir__)
FROM = (ARGV[0] || 1970).to_i
TO = (ARGV[1] || 2037).to_i
ZONEINFO = ENV['TZDIR'] || '/usr/share/zoneinfo'

$host_calls = 0
module JS
  Num = Struct.new(:v) do
    def to_f = v.to_f
    def to_s = v.to_s
  end

  # The patch calls JS.global[:tjTz].call(:offset, zone, epoch) and
  # .call(:valid, zone).
  class Host
    def call(name, zone, epoch = nil)
      return Num.new(true) if name == :valid

      $host_calls += 1
      saved = ENV['TZ']
      ENV['TZ'] = zone
      Num.new(Time.at(epoch.to_i).__tj_localtime.utc_offset)
    ensure
      ENV['TZ'] = saved if name == :offset
    end
  end

  def self.global = { tjTz: Host.new }
end
$LOADED_FEATURES << 'js.rb'
class TaskJuggler
  class TjTime; end
end
load PATCH

zones = ARGV[2..] || []
if zones.empty?
  zones = File.readlines(File.join(ZONEINFO, 'tzdata.zi')).grep(/^Z /).map { |l| l.split[1] }
  zones = zones.select { |z| z.include?('/') }
end

UT = / (\w{3} \w{3}\s+\d+ \d\d:\d\d:\d\d \d+) UT /.freeze

# [instant, offset before, offset after] for every change of +zone+.
def changes(zone)
  lines = IO.popen(['zdump', '-v', '-c', "#{FROM},#{TO + 1}", zone], &:readlines)
  lines.reject { |l| l.include?('NULL') }.each_slice(2).filter_map do |a, b|
    next unless b && (m = UT.match(b))

    t = Time.strptime("#{m[1]} UTC", '%a %b %d %H:%M:%S %Y %Z').to_i
    [t, a[/gmtoff=(-?\d+)/, 1].to_i, b[/gmtoff=(-?\d+)/, 1].to_i]
  end
end

cases = 0
explained = Hash.new(0)
unexplained = []
zones.each do |zone|
  changes(zone).each do |t, before, after|
    lo = t + [before, after].min - 3 * 3600
    hi = t + [before, after].max + 3 * 3600
    walls = (lo.div(900)..hi.div(900)).map { |k| k * 900 } | [t + before, t + after]
    walls.each do |wall|
      u = Time.at(wall).utc
      args = [u.year, u.month, u.day, u.hour, u.min, u.sec]
      ENV['TZ'] = zone
      native = Time.__tj_utc_local(*args)
      patched = Time.local(*args)
      cases += 1
      same = native.to_i == patched.to_i && native.utc_offset == patched.utc_offset &&
             native.hour == patched.hour
      next if same

      if t % 900 != 0
        explained[:off_quarter_hour] += 1
      elsif before - after > 7200
        explained[:long_overlap] += 1
      else
        unexplained << "#{zone} #{args.inspect}: native #{native.getutc} (#{native.utc_offset}), " \
                       "patched #{patched.getutc} (#{patched.utc_offset})"
      end
    end
  end
end

puts "Ruby #{RUBY_VERSION}, #{zones.size} zones, changes #{FROM}-#{TO}: #{cases} local times, " \
     "#{$host_calls} host calls"
puts "explained differences: #{explained[:off_quarter_hour]} at changes off a quarter hour, " \
     "#{explained[:long_overlap]} in overlaps longer than two hours"
puts "unexplained differences: #{unexplained.size}"
unexplained.first(20).each { |l| puts "  #{l}" }
exit(unexplained.empty? ? 0 : 1)
