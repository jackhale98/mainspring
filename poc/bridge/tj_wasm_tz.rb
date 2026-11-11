# tj_wasm_tz.rb - real time zones for TaskJuggler under ruby.wasm.
#
# WASI's C library only knows UTC, so ENV['TZ'] is ignored and every
# Time.local/#localtime silently becomes UTC. TaskJuggler relies on TZ for
# all local-time math, so we route those calls through the host's
# Intl time-zone database (globalThis.tjTz, defined in tj-runtime.mjs).
require 'js'

module TJWasmTZ
  @cache = {}
  def self.zone
    z = ENV['TZ']
    z.nil? || z.empty? || z == 'UTC' ? nil : z
  end

  # UTC offset in seconds of +zone+ at UTC instant +epoch+.
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
