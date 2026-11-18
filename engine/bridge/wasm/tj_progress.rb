# SPDX-License-Identifier: GPL-2.0-or-later
#
# tj_progress.rb - beat sites inside TaskJuggler's own run (progress.rb says
# why, and the rule every site keeps: at most once per item of finite input).
# Loaded with the wasm patches. Each hook ticks, then calls TaskJuggler's own
# method, so no result changes. Measured on the first fedora-res run of a cold
# WebKit worker (iphone-14 project, 4-CPU box), the longest stretch without a
# site was 3.2 s with only the meter, idle (the grammar build); 4.0-7.4 s with
# every site here but the last, two such runs in parallel (the working-hours
# scoreboard); with all of them, under 0.6 s in the same parallel runs.
#
# - TaskJuggler's progress meter (Log.rb:117-170): startProgressMeter for each
#   file read and each scenario phase, `progress` per resource prepared, per
#   10 tasks scheduled and per top-level task checked (Project.rb:1065-1203),
#   `activity` every 1024 lines read (Scanner.rb:102-117). The bridge leaves
#   Log silent, so upstream these return at once.
# - The grammar build (TextParser#updateParserTables, TextParser.rb:175-193):
#   Rule#generateStates per rule and State#addTransitions per state, about 380
#   and 1,800 calls. It runs on a worker's first parse and again after a plan
#   with an `extend` block (wasm/tj_parser_cache.rb), and took 2.4-3.2 s of
#   the first fedora-res parse with no meter call.
# - Every line read from a source file: StreamHandle#readyNextLine reads with
#   the stream's `gets` (Scanner.rb:105), so the stream of each
#   FileStreamHandle gets a `gets` that ticks. The meter fires only every
#   1024 lines; a 518-line include took 1.7 s. Macro text is scanned without
#   `gets`, so a macro expansion that never ends ticks nothing.
# - Every 1024th slot of Scoreboard#each_index, which only
#   Project#computeResourceAvailabilities uses (Project.rb:1303-1316): it
#   checks each used resource in every slot of the frame, between two meter
#   calls. 2.7 s natively for 4 years at 15 minutes with 60 people.
# - Every 1024th slot of Scoreboard#collect!, which only
#   WorkingHours#initScoreboard uses (WorkingHours.rb:209-240): it computes
#   every slot of the frame when a set of working hours is first copied
#   (WorkingHours.rb:52-54; fedora-res: the project's at its first resource,
#   and a part-timer's own). 35 ms each natively, and 4-7 s of the parse in
#   the parallel cold WebKit runs.
class TaskJuggler
  class Log
    # Log's methods are singleton methods (`def Log.progress`).
    module MainspringProgress
      def startProgressMeter(text)
        MainspringBridge::Progress.tick
        super
      end

      def stopProgressMeter
        MainspringBridge::Progress.tick
        super
      end

      def activity
        MainspringBridge::Progress.tick
        super
      end

      def progress(percent)
        MainspringBridge::Progress.tick
        super
      end
    end

    singleton_class.prepend(MainspringProgress)
  end

  class TextParser
    module RuleProgress
      def generateStates(rules)
        MainspringBridge::Progress.tick
        super
      end
    end

    module StateProgress
      def addTransitions(states, rules)
        MainspringBridge::Progress.tick
        super
      end
    end

    Rule.prepend(RuleProgress)
    State.prepend(StateProgress)

    class Scanner
      # Extends the StringIO a FileStreamHandle reads from.
      module LineProgress
        def gets(*args)
          MainspringBridge::Progress.tick
          super
        end
      end

      module FileStreamProgress
        def initialize(fileName, log, textScanner)
          super
          @stream.extend(LineProgress) if @stream.is_a?(StringIO)
        end
      end

      FileStreamHandle.prepend(FileStreamProgress)
    end
  end

  class Scoreboard
    module EachIndexProgress
      def each_index
        return super unless block_given?

        super do |index|
          MainspringBridge::Progress.tick if (index & 0x3FF).zero?
          yield index
        end
      end
    end

    module CollectProgress
      def collect!
        return super unless block_given?

        index = 0
        super do |slot|
          MainspringBridge::Progress.tick if (index & 0x3FF).zero?
          index += 1
          yield slot
        end
      end
    end

    prepend(EachIndexProgress)
    prepend(CollectProgress)
  end
end
