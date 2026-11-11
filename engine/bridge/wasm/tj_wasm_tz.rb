# SPDX-License-Identifier: GPL-2.0-or-later
#
# tj_wasm_tz.rb - real time zones for TaskJuggler under ruby.wasm (ported
# from poc/bridge/tj_wasm_tz.rb; Time.local now resolves DST gaps and
# overlaps like native Ruby, see local_to_utc). Wasm only.
#
# WASI's C library only knows UTC, so ENV['TZ'] is ignored and every
# Time.local / Time#localtime silently becomes UTC. TaskJuggler relies on TZ
# for all local-time math, so these calls are routed through the host's Intl
# time-zone database. The worker must define globalThis.tjTz with:
#
#   offset(zone: string, epochSeconds: number) -> number
#       UTC offset in seconds of `zone` at that UTC instant
#   valid(zone: string) -> boolean
#
# (src/engine/runtime.ts, createTimeZoneHost, is the implementation).
#
# TjTime.checkTimeZone is replaced by an Intl-based check. It keeps upstream's
# rules that 'UTC' is valid and that other zones need a '/'; upstream's
# ENV['TZ'] probe cannot work without zoneinfo.
require 'js'

module TJWasmTZ
  DAY = 86_400

  @cache = {}

  def self.zone
    z = ENV['TZ']
    z.nil? || z.empty? || z == 'UTC' ? nil : z
  end

  # UTC offset in seconds of +zone+ at UTC instant +epoch+, cached per
  # 15-minute block of UTC time. Every caller passes a UTC instant (never a
  # local wall-clock value), so the key is the instant's block. The cache
  # assumes every offset change in a zone falls on a 15-minute UTC boundary.
  # That holds for every zone in tzdata 2026e from 2023 to 2037, so for the
  # golden corpus (2026 to 2028), but not for every historical rule: local
  # mean time offsets have odd minutes and seconds, and some changes happened
  # off the quarter hour (the latest: Antarctica/Casey, 2020 to 2022, at
  # hh:01 UTC).
  def self.offset(zone, epoch)
    key = [zone, epoch.to_i.div(900)]
    @cache[key] ||= JS.global[:tjTz].call(:offset, zone, epoch.to_i.to_f).to_f.to_i
  end

  # The UTC instant of a local wall-clock time in +zone+, and the zone's
  # offset at that instant, as [epoch, offset]. +wall+ is the local date and
  # time counted as if it were UTC (Time.utc(*args).to_i).
  #
  # It resolves wall-clock times the way native Ruby's Time.local does
  # (find_time_t in time.c, the same in Ruby 3.3 and 3.4; it searches with
  # localtime_r and never calls mktime), checked against native Ruby 3.3.6 on
  # glibc for every tzdata 2026e zone and change from 1970 to 2037:
  #
  # - a time that exists once is that instant;
  # - a time repeated by a backward change (overlap) is the later instant,
  #   the one after the change: New York 2026-11-01 01:00 is 06:00Z (EST);
  # - a time skipped by a forward change (gap) is read with the offset in
  #   force before the change, so it lands as far after the change as it is
  #   after the gap's start: New York 2026-03-08 02:30 is 07:30Z (03:30 EDT).
  #
  # The offsets one day before and after +wall+ are the offsets on both sides
  # of any change near it (offsets stay within -12 h to +14 h, and no zone
  # changes twice within two days in that range), so the candidates are
  # wall - before and wall - after. The one difference found is an overlap
  # longer than two hours (only Antarctica/Rothera, 1976-12-01): Ruby looks
  # only two hours ahead for the later instant, so in the first hour of that
  # three-hour overlap it returns the earlier one.
  #
  # The previous version (from the PoC) applied the offset at wall, then the
  # offset at wall minus that. That matched native for the corpus zones east
  # of UTC (Berlin, Sydney, Kathmandu), where wall counted as UTC is later
  # than the instant, but west of UTC it chose the earlier instant in an
  # overlap and the offset after the change in a gap (New York 02:00 on
  # 2026-03-08 became 06:00Z, not 07:00Z).
  def self.local_to_utc(zone, wall)
    before = offset(zone, wall - DAY)
    after = offset(zone, wall + DAY)
    return [wall - before, before] if before == after

    # Valid with the offset after the change: the unique instant, or the
    # later of two in an overlap.
    t = wall - after
    return [t, after] if offset(zone, t) == after

    # Valid with the offset before the change, or a gap: read with the offset
    # before the change, which lands after it.
    t = wall - before
    [t, offset(zone, t)]
  end

  def self.valid?(zone)
    JS.global[:tjTz].call(:valid, zone).to_s == 'true'
  end
end

class Time
  class << self
    alias_method :__tj_utc_local, :local
    def local(*args)
      zone = TJWasmTZ.zone
      return __tj_utc_local(*args) unless zone

      t, off = TJWasmTZ.local_to_utc(zone, Time.utc(*args).to_i)
      Time.at(t).__tj_localtime(off)
    end
    alias_method :mktime, :local
  end

  alias_method :__tj_localtime, :localtime
  def localtime(*args)
    return __tj_localtime(*args) unless args.empty?

    zone = TJWasmTZ.zone
    zone ? __tj_localtime(TJWasmTZ.offset(zone, to_i)) : __tj_localtime
  end
end

class TaskJuggler::TjTime
  def self.checkTimeZone(zone)
    return true if zone == 'UTC'

    zone.include?('/') && TJWasmTZ.valid?(zone)
  end
end
