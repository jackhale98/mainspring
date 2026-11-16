# SPDX-License-Identifier: GPL-2.0-or-later
#
# check-unused-scan.rb - developer check (native Ruby only, like the recorder)
# for engine/bridge/serialize.rb #unused_scan: the working time and leaves it
# computes for a leaf resource without a scoreboard must be exactly what
# TaskJuggler's own scoreboard gives (ResourceScenario#initScoreboard).
#
#   BUNDLE_GEMFILE=engine/golden/Gemfile bundle exec ruby -EUTF-8 \
#     -I engine/tj/lib engine/golden/check-unused-scan.rb [<plan.tjp>]...
#
# With no arguments it checks every plan of manifest.json. For each active
# scenario and each leaf resource without shifts it compares, as [first,
# stop) slot runs per class (so slot by slot), #classify_unused with the
# scan of the resource's scoreboard: the one scheduling built for a used
# resource (its booked slots count as working time, as they were free
# before booking; an `overtime` booking would show here as a difference),
# or one built now through ResourceScenario#getWorkSlots for an unused
# resource. Exits 1 on any difference.
require 'json'
require 'taskjuggler/TaskJuggler'
require_relative '../bridge/request'

module CheckUnusedScan
  module_function

  def plans(argv)
    return argv.map { |p| [File.basename(File.dirname(p)), File.expand_path(p), nil] } unless argv.empty?

    repo = File.expand_path('../..', __dir__)
    JSON.parse(File.read(File.join(__dir__, 'manifest.json'))).map do |p|
      [p['id'], File.join(repo, p['root'], p['entry']), p['now']]
    end
  end

  def schedule(path, now)
    Encoding.default_external = Encoding::UTF_8
    mh = TaskJuggler::MessageHandlerInstance.instance
    mh.reset
    mh.outputLevel = :none
    mh.trapSetup = true
    MainspringBridge::Capture.reset(MainspringBridge.parse_now(now))
    Dir.chdir(File.dirname(path)) do
      tj = TaskJuggler.new
      parsed = begin
        tj.parse([path])
      rescue TaskJuggler::TjRuntimeError, TaskJuggler::TjException, RuntimeError
        false
      end
      return nil unless parsed && mh.errors.zero?

      begin
        tj.schedule
      rescue TaskJuggler::TjRuntimeError, TaskJuggler::TjException, RuntimeError
        nil
      end
      tj.project
    end
  end

  def check(id, path, now)
    project = schedule(path, now)
    return [0, 0, 0, []] unless project

    ser = MainspringBridge::Serializer.new(File.dirname(path))
    ser.result(true, project, nil, { 'version' => nil, 'timezone' => nil }, [])
    checked = unused = slots = 0
    diffs = []
    project.scenarios.each do |sc|
      next unless sc.get('active')

      idx = project.scenarioIdx(sc)
      project.resources.each do |r|
        next if r.container? || r['shifts', idx]

        runs = ser.send(:on_shift_runs, r['workinghours', idx])
        next unless runs

        own = r['leaves', idx].map { |l| ser.send(:leave_slots, l) }
        ours = ser.send(:classify_unused, runs, own)
        rs = r.data[idx]
        unless rs.instance_variable_get(:@scoreboard)
          unused += 1
          rs.getWorkSlots(0, 1)
        end
        theirs = ser.send(:scan_scoreboard, rs)
        checked += 1
        slots += project.scoreboardSize
        next if ours.working == theirs.working && ours.leaves == theirs.leaves

        diffs << "#{id} #{sc.fullId} #{r.fullId}: working #{ours.working.length} vs " \
                 "#{theirs.working.length} runs, leaves #{ours.leaves.inspect[0, 120]} vs " \
                 "#{theirs.leaves.inspect[0, 120]}"
      end
    end
    [checked, unused, slots, diffs]
  end

  def main(argv)
    total = unused = slots = 0
    all = []
    plans(argv).each do |id, path, now|
      c, u, s, d = check(id, path, now)
      total += c
      unused += u
      slots += s
      all.concat(d)
      puts "#{id}: #{c} resource scenarios (#{u} without a scoreboard), #{d.length} difference(s)" if c.positive?
    end
    all.first(20).each { |d| puts "  #{d}" }
    puts "#{total} resource scenarios, #{unused} without a scoreboard, #{slots} slots: " \
         "#{all.empty? ? 'all identical' : "#{all.length} difference(s)"}"
    exit(all.empty? ? 0 : 1)
  end
end

CheckUnusedScan.main(ARGV) if $PROGRAM_NAME == __FILE__
