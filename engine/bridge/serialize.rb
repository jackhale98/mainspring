# SPDX-License-Identifier: GPL-2.0-or-later
#
# serialize.rb - turn a parsed and scheduled TaskJuggler project into a
# ScheduleResult v2 (docs/phases/phase-0.md, section 3.1, plus the fields of
# docs/phases/phase-2.md, section 6.1), without `revision` and `timings`,
# which the caller adds.
#
# Shared by the browser bridge (tj_bridge.rb on ruby.wasm) and the native
# golden recorder (native/record.rb). It must load on plain native Ruby with
# unmodified TaskJuggler and no wasm/ patches, so it only reads TaskJuggler's
# public data and APIs. Output rules (spec 6.3):
#
# - tasks, resources and scenarios in declaration pre-order: roots in
#   declaration order, each followed by its children in declaration order;
# - task and booking dates as integer minutes since project start (UTC);
#   project start, end and now as ISO 8601 UTC with 'Z';
# - per-task results for active scenarios only, keyed by scenario id;
# - bookings: every scoreboard allocation per scenario, resource and task
#   (the slots ResourceScenario#getBookings, which TaskJuggler's own `export`
#   report uses, returns; read slot by slot, see #bookings), contiguous slots
#   merged, sorted by scenario, resource and task pre-order, then first
#   interval start;
# - messages in emission order, paths workspace-relative, no ANSI codes.
#
# TaskJuggler 3.8.4 tracks line numbers only: every SourceFileInfo has column
# 0. Column 0 and line 0 mean "unknown" and are emitted as null.
#
# Over 400 lines on purpose (CLAUDE.md): the browser and the native recorder
# must share one serializer, and a large part of it cites where TaskJuggler
# keeps each value.
#
# Schema v2 adds fields only (phase-2 spec 6.1); every v1 field is unchanged.
# Where TaskJuggler keeps each value (paths under engine/tj/lib/taskjuggler/,
# TaskJuggler 3.8.4 at 3b36c79):
#
# - ProjectInfo.dailyWorkingHours: the project attribute 'dailyworkinghours'
#   (Project.rb:80, default 8.0; Project#dailyWorkingHours at Project.rb:539).
# - ProjectInfo.weeklyWorkingDays, monthlyWorkingDays and yearlyWorkingDays:
#   the day counts TaskJuggler's working-duration rule multiplies by for the
#   'w', 'm' and 'y' units (TjpSyntaxRules.rb:7667-7682), each computed the
#   way that rule computes it: Project#weeklyWorkingDays (Project.rb:542-545:
#   WorkingHours#weeklyWorkingHours, whole hours, WorkingHours.rb:168-176,
#   divided by 'dailyworkinghours'), the attribute 'yearlyworkingdays' divided
#   by 12 with Ruby's division (an integer `yearlyworkingdays 260` gives 21,
#   not Project#monthlyWorkingDays' 21.67), and 'yearlyworkingdays' itself
#   (Project.rb:106, default 260.714). The parser stores both attributes as
#   written, Integer or Float (TjpSyntaxRules.rb:2932-2935, 3228-3229,
#   3404-3405).
# - ProjectInfo.workingTime: the project scoreboard, read slot by slot with
#   Project#isWorkingTime(Integer) (Project.rb:880-886). Project#schedule
#   builds it first (Project.rb:631-632, initScoreboards at Project.rb:1269):
#   a slot is nil (working) when the global working hours are on shift and no
#   global leave covers it. A failed parse never reaches Project#schedule, so
#   the header has no scoreboard and the list is empty.
# - TaskScenarioResult.direction: the scenario attribute 'forward'
#   (Project.rb:283, inherited, default true), as it stands after scheduling.
#   The parser sets it from scheduling/start/depends (true) and end/precedes
#   (false) (TjpSyntaxRules.rb:6345-6351, 6444-6449, 6594-6600, 6684-6695,
#   6789-6794), and TaskScenario#bookBookings forces true for effortdone and
#   effortleft (TaskScenario.rb:2007-2009).
# - TaskScenarioResult.complete: the scenario attribute 'complete'
#   (Project.rb:257, not inherited, default nil). TaskJuggler computes a value
#   (TaskScenario#calcCompletion, TaskScenario.rb:2425-2437) only when a query
#   reads completion: reports, which the bridge never runs, or a fail/warn
#   condition (PropertyTreeNode.rb:549-571), on both sides alike.
# - TaskScenarioResult.depends and precedes: the scenario attributes 'depends'
#   and 'precedes' (Project.rb:263, 311; DependencyListAttribute, inherited
#   from the parent at creation, then the task's own entries appended,
#   TjpSyntaxRules.rb:6347, 6596), lists of TaskDependency (TaskDependency.rb:
#   taskId, task, onEnd, gapDuration in seconds, gapLength in slots).
#   TaskScenario#Xref resolves each entry's task and drops the broken ones
#   (TaskScenario.rb:166-179, checkDependency at TaskScenario.rb:2318-2361);
#   #dependencies applies the same rules to entries it never reached.
require 'json'

module MainspringBridge
  # Raised when the serializer meets data it cannot represent exactly, such as
  # a date that is not a whole number of minutes after the project start.
  class SerializeError < StandardError; end

  class Serializer
    ANSI_RE = /\e\[[0-9;]*[A-Za-z]/.freeze
    LEVELS = %i[fatal error warning info debug].freeze

    # Build the result Hash (string keys). _project_ is the TaskJuggler::Project
    # after a successful parse, or nil. _header_ is the Project created by the
    # parser, used for ProjectInfo when the parse failed after the header.
    # _meta_ holds what the plan wrote that TaskJuggler does not keep apart
    # from its defaults: { 'version' => String|nil, 'timezone' => String|nil }.
    def self.result(ok:, project:, header:, meta:, messages:, workspace_root:)
      new(workspace_root).result(ok, project, header, meta, messages)
    end

    def initialize(workspace_root)
      @root = workspace_root.chomp('/')
      @rootPrefix = @root + '/'
    end

    def result(ok, project, header, meta, messages)
      info_source = project || header
      @start = info_source && info_source['start']
      # Only a parsed project went through Project#schedule, which builds the
      # scoreboard that workingTime reads: MainspringBridge.run schedules every
      # project that parsed (request.rb:169), and Project#schedule builds the
      # scoreboard before anything that can fail (Project.rb:631-632).
      info = info_source && project_info(info_source, meta, !project.nil?)
      out = {
        'ok' => ok ? true : false,
        'project' => info,
        'tasks' => [],
        'resources' => [],
        'bookings' => [],
        'messages' => messages.map { |m| message(m) }
      }
      return out unless project && info

      @project = project
      @slotMin = project['scheduleGranularity'] / 60
      scenarios = preorder(project.scenarios)
      @active = scenarios.select { |sc| sc.get('active') }
                         .map { |sc| [sc.fullId, project.scenarioIdx(sc)] }
      resources = preorder(project.resources)
      tasks = preorder(project.tasks)
      @resourceRank = {}
      resources.each_with_index { |r, i| @resourceRank[r] = i }
      @taskRank = {}
      tasks.each_with_index { |t, i| @taskRank[t] = i }

      out['tasks'] = tasks.map { |t| task(t) }
      out['resources'] = resources.map { |r| resource(r) }
      out['bookings'] = bookings(project, resources)
      out
    end

    private

    def project_info(p, meta, scheduled)
      {
        'id' => p['projectid'],
        'name' => p['name'],
        'version' => meta['version'],
        'start' => iso(p['start']),
        'end' => iso(p['end']),
        'now' => iso(p['now']),
        'timezone' => meta['timezone'],
        'timingResolutionMin' => p['scheduleGranularity'] / 60,
        'scenarios' => preorder(p.scenarios).map do |sc|
          { 'id' => sc.fullId, 'name' => sc.name,
            'parent' => sc.parent && sc.parent.fullId,
            'active' => sc.get('active') ? true : false }
        end,
        'dailyWorkingHours' => p['dailyworkinghours'],
        # A `dailyworkinghours 0.0` makes this Infinity, which JSON cannot hold
        # (an integer 0 already stops TaskJuggler's parse with ZeroDivisionError).
        'weeklyWorkingDays' => finite(p.weeklyWorkingDays),
        # As TjpSyntaxRules.rb:7674-7675 computes it, so Integer#/ for an integer.
        'monthlyWorkingDays' => p['yearlyworkingdays'] / 12,
        'yearlyWorkingDays' => p['yearlyworkingdays'],
        # _scheduled_ is true exactly for a parsed project; see #result
        # (request.rb:169 schedules every project that parsed).
        'workingTime' => scheduled ? working_time(p) : []
      }
    end

    def finite(value)
      value.is_a?(Float) && !value.finite? ? nil : value
    end

    # The project's working time as merged [start, end) minute pairs: maximal
    # runs of scoreboard slots for which Project#isWorkingTime is true. Slots
    # from scoreboardSize on are never working time (initScoreboards marks only
    # the first scoreboardSize slots, Project.rb:1283), so they are not read.
    def working_time(p)
      out = []
      size = p.scoreboardSize
      first = nil
      i = 0
      while i < size
        if p.isWorkingTime(i)
          first ||= i
        elsif first
          out << slot_pair(p, first, i)
          first = nil
        end
        i += 1
      end
      out << slot_pair(p, first, size) if first
      out
    end

    def slot_pair(p, first, stop)
      [minutes(p.idxToDate(first)), minutes(p.idxToDate(stop))]
    end

    def task(t)
      scenarios = {}
      milestone = nil
      @active.each do |id, idx|
        milestone = t['milestone', idx] ? true : false if milestone.nil?
        allocated = (t['assignedresources', idx] || []).sort_by { |r| @resourceRank[r] }
        scenarios[id] = {
          'scheduled' => t['scheduled', idx] ? true : false,
          'start' => minutes(t['start', idx]),
          'end' => minutes(t['end', idx]),
          'allocated' => allocated.map(&:fullId),
          'criticalness' => t['criticalness', idx],
          'pathCriticalness' => t['pathcriticalness', idx],
          # v2 (phase-2 spec 6.1); sources in the header comment.
          'direction' => t['forward', idx] ? 'asap' : 'alap',
          'complete' => t['complete', idx],
          'depends' => dependencies(t, t['depends', idx]),
          'precedes' => dependencies(t, t['precedes', idx])
        }
      end
      # 'milestone' is scenario-specific in TaskJuggler; the protocol has one
      # value per task, taken from the first active scenario in pre-order.
      {
        'id' => t.fullId, 'name' => t.name,
        'parent' => t.parent && t.parent.fullId,
        'source' => source_ref(t.sourceFileInfo),
        'milestone' => milestone ? true : false,
        'scenarios' => scenarios
      }
    end

    # DependencyResult entries for _owner_'s 'depends' or 'precedes' list, in
    # its order. TaskScenario#Xref sets each entry's task (TaskDependency#resolve,
    # TaskDependency.rb:42-44, which is Project#task(taskId), Project.rb:605)
    # and TaskScenario#checkDependency (TaskScenario.rb:2318-2361) removes, and
    # reports, an entry whose task is unknown, the owner itself, a child of the
    # owner or a parent of it, or a task an earlier entry of the same list
    # already names. The first such error stops the run, so the entries of
    # later tasks, and of scenarios never prepared, are neither resolved nor
    # checked. Here every entry is looked up the same way (an entry Xref
    # resolved keeps its task) and the same five rules leave entries out,
    # without changing TaskJuggler's objects. Entries Xref accepted pass them
    # all, so a complete run is unaffected. The parser already made relative
    # ids absolute (TjpSyntaxRules.rb:6082-6096). Task has no #==, so tasks
    # compare by identity, as in checkDependency.
    def dependencies(owner, list)
      seen = {}.compare_by_identity
      list.filter_map do |dep|
        task = dep.task || @project.task(dep.taskId)
        next if task.nil? || task.equal?(owner) || task.isChildOf?(owner) ||
                owner.isChildOf?(task) || seen.key?(task)

        seen[task] = true
        {
          'task' => task.fullId,
          'onEnd' => dep.onEnd ? true : false,
          'gapDurationMin' => gap_minutes(dep.gapDuration),
          'gapLengthMin' => dep.gapLength * @slotMin
        }
      end
    end

    # gapduration is stored in seconds and is a multiple of the timing
    # resolution (TjpSyntaxRules.rb:2058-2063), so whole minutes.
    def gap_minutes(secs)
      whole = secs.round
      if secs != whole || whole % 60 != 0
        raise SerializeError, "gapduration of #{secs} s is not a whole number of minutes"
      end

      whole / 60
    end

    def resource(r)
      scenarios = {}
      @active.each do |id, idx|
        scenarios[id] = { 'efficiency' => r['efficiency', idx] }
      end
      {
        'id' => r.fullId, 'name' => r.name,
        'parent' => r.parent && r.parent.fullId,
        'source' => source_ref(r.sourceFileInfo),
        'group' => r.container? ? true : false,
        'scenarios' => scenarios
      }
    end

    # Every booked scoreboard slot, grouped by resource and task. This yields
    # what ResourceScenario#getBookings yields once contiguous slots are
    # merged: getBookings walks the slots from the first to the last booked
    # one and cuts an interval wherever the task changes, and every Task in a
    # scoreboard is written by ResourceScenario#book, which keeps those first
    # and last slots. getBookings itself is not used because its scan compares
    # each Integer slot value with nil through Integer#!=, which takes Ruby's
    # recursion guard; under ruby.wasm's setjmp emulation that made the
    # 1,000-task golden spend 4.7 s in getBookings, against about 0.25 s for
    # this scan. The output is unchanged (golden:verify and the wasm golden
    # run both match).
    def bookings(project, resources)
      out = []
      # Scanning scoreboardSize slots is enough: Scoreboard allocates ceil(...)+1 slots and
      # never sets slots >= scoreboardSize to nil, so available? is false there, and booking
      # indices stop at endIdx-1 <= scoreboardSize-1.
      size = project.scoreboardSize
      @active.each do |scenarioId, idx|
        resources.each do |r|
          # Only leaf resources hold bookings. ResourceScenario#book adds the
          # task to the resource's duties before it books a slot, so a leaf
          # without duties has no booked slot (and maybe no scoreboard).
          next if r.container? || r['duties', idx].empty?

          runs = slot_runs(r.data[idx], size)
          runs.keys.sort_by { |t| @taskRank[t] }.each do |t|
            pairs = runs[t].map do |s, e|
              [minutes(project.idxToDate(s)), minutes(project.idxToDate(e))]
            end
            out << { 'scenario' => scenarioId, 'resource' => r.fullId,
                     'task' => t.fullId, 'intervals' => merge(pairs) }
          end
        end
      end
      out
    end

    # The maximal runs of slots booked for one task, as
    # { task => [[firstSlot, lastSlot + 1], ...] } in ascending order.
    # _rs_ is a ResourceScenario; bookedTask returns the Task or nil.
    def slot_runs(rs, size)
      runs = {}
      current = nil
      first = 0
      i = 0
      while i < size
        task = rs.bookedTask(i)
        unless task.equal?(current)
          (runs[current] ||= []) << [first, i] if current
          current = task
          first = i
        end
        i += 1
      end
      (runs[current] ||= []) << [first, size] if current
      runs
    end

    # _pairs_ ([start, end] minutes, ascending by start) with touching or
    # overlapping pairs merged. slot_runs already returns ascending runs.
    def merge(pairs)
      merged = []
      pairs.each do |s, e|
        if (last = merged.last) && s <= last[1]
          last[1] = e if e > last[1]
        else
          merged << [s, e]
        end
      end
      merged
    end

    def message(m)
      sfi = m.sourceFileInfo
      scenario = m.instance_variable_get(:@scenario)
      line = sfi && sfi.lineNo
      column = sfi && sfi.columnNo
      {
        'level' => LEVELS.include?(m.type) ? m.type.to_s : 'error',
        'id' => m.id.to_s,
        'text' => clean_text(m.message || ''),
        'file' => sfi && workspace_path(sfi.fileName),
        'line' => line && line > 0 ? line : nil,
        'column' => column && column > 0 ? column : nil,
        'scenario' => scenario && scenario.fullId
      }
    end

    def source_ref(sfi)
      return nil unless sfi

      { 'file' => workspace_path(sfi.fileName),
        'line' => sfi.lineNo > 0 ? sfi.lineNo : nil,
        'column' => sfi.columnNo > 0 ? sfi.columnNo : nil }
    end

    def clean_text(text)
      text.to_s.gsub(ANSI_RE, '').gsub(@rootPrefix, '')
    end

    # Lexically normalise _name_ (no symlink lookups) and make it relative to
    # the workspace root. Paths outside the workspace give nil.
    def workspace_path(name)
      return nil if name.nil? || name.empty?

      path = name.start_with?('/') ? name : "#{@rootPrefix}#{name}"
      parts = []
      path.split('/').each do |seg|
        next if seg.empty? || seg == '.'

        if seg == '..'
          parts.pop
        else
          parts << seg
        end
      end
      norm = '/' + parts.join('/')
      norm.start_with?(@rootPrefix) ? norm[@rootPrefix.length..] : nil
    end

    def iso(t)
      t && t.to_s('%Y-%m-%dT%H:%M:%SZ', 'UTC')
    end

    def minutes(t)
      return nil if t.nil?

      secs = t - @start
      whole = secs.round
      if secs != whole || whole % 60 != 0
        raise SerializeError,
              "#{t.to_s('%Y-%m-%dT%H:%M:%SZ', 'UTC')} is not a whole number " \
              "of minutes after the project start"
      end
      whole / 60
    end

    def preorder(set)
      out = []
      stack = []
      set.each { |p| stack << p if p.parent.nil? }
      stack.reverse!
      until stack.empty?
        p = stack.pop
        out << p
        p.children.reverse_each { |c| stack << c }
      end
      out
    end
  end
end
