# SPDX-License-Identifier: GPL-2.0-or-later
#
# progress.rb - progress beats for the engine client's reply watchdog.
#
# Ruby runs a request synchronously, so the worker can post nothing while
# TaskJuggler parses and schedules and the bridge serializes. The client
# (src/engine/client.ts) terminates a worker that owes a reply and sends
# nothing for `timeoutMs` (60 s). A slow engine (WebKit before its optimizing
# tier has compiled ruby.wasm, a loaded machine, an older phone) can take
# longer than that on a big plan while advancing all the time. So the bridge
# calls `tick` at points that mark progress, and at most once per `interval`
# ms `tick` calls the worker's host (`beat()`, src/engine/runtime.ts), which
# posts a `progress` message; the client restarts its countdown on it.
#
# The rule for beat sites: each runs at most once per item of finite input
# (a source line read, a grammar rule or state built, a task or resource
# serialized, a keyword documented), or is one of TaskJuggler's own
# progress-meter calls, which sit in loops over such items
# (wasm/tj_progress.rb). An endless loop then passes no site, so a hung
# worker still goes silent and is terminated. Never tick from a loop that
# might not end, and never from a timer: the beat says "advanced", not
# "alive".
#
# Without a host (native Ruby, and before the worker connects one) `tick`
# returns at once. A beat changes no result: it reads the clock and calls the
# host, and an error from the host is dropped.
module MainspringBridge
  module Progress
    @host = nil
    @interval = 1000.0
    @due = 0.0

    class << self
      # _host_ is a JS object with a `beat()` method, or nil to disconnect.
      def connect(host, interval_ms)
        @host = host
        @interval = interval_ms.to_f
        @due = 0.0
        nil
      end

      def tick
        return unless @host

        now = Process.clock_gettime(Process::CLOCK_MONOTONIC, :float_millisecond)
        return if now < @due

        @due = now + @interval
        @host.call(:beat)
        nil
      rescue StandardError
        nil
      end
    end
  end
end
