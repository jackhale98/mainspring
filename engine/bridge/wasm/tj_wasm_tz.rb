# SPDX-License-Identifier: GPL-2.0-or-later
#
# tj_wasm_tz.rb - real time zones for TaskJuggler under ruby.wasm (ported
# unchanged in behaviour from poc/bridge/tj_wasm_tz.rb). Wasm only.
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
# (see poc/web/tj-runtime.mjs for the reference implementation).
#
# TjTime.checkTimeZone is replaced by an Intl-based check. It keeps upstream's
# rules that 'UTC' is valid and that other zones need a '/'; upstream's
# ENV['TZ'] probe cannot work without zoneinfo.
require 'js'

module TJWasmTZ
  @cache = {}

  def self.zone
    z = ENV['TZ']
    z.nil? || z.empty? || z == 'UTC' ? nil : z
  end

  # UTC offset in seconds of +zone+ at UTC instant +epoch+, cached per
  # 15-minute block of UTC time. The cache assumes every offset change in a
  # zone falls on a 15-minute UTC boundary. That holds for the zones and years
  # in the golden corpus (2026 to 2028), but not for every historical rule
  # (local mean time offsets, for example, have odd minutes and seconds).
  def self.offset(zone, epoch)
    key = [zone, epoch.to_i.div(900)]
    @cache[key] ||= JS.global[:tjTz].call(:offset, zone, epoch.to_i.to_f).to_f.to_i
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

      base = Time.utc(*args).to_i
      off = TJWasmTZ.offset(zone, base)
      off = TJWasmTZ.offset(zone, base - off)
      Time.at(base - off).__tj_localtime(off)
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
