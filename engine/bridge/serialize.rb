# SPDX-License-Identifier: GPL-2.0-or-later
#
# serialize.rb - turn a parsed and scheduled TaskJuggler project into a
# ScheduleResult v3 (docs/phases/phase-0.md, section 3.1, plus the fields of
# docs/phases/phase-2.md, section 6.1, and docs/phases/phase-3.md, section
# 6.1), without `revision` and `timings`, which the caller adds.
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
#
# Schema v3 adds fields only (phase-3 spec 6.1, ADR-0014 #1); every v2 field
# is unchanged:
#
# - ProjectInfo.weekStartsMonday: the project attribute 'weekStartsMonday'
#   (Project.rb:104, default true; set by weekstartsmonday and
#   weekstartssunday, TjpSyntaxRules.rb:3389-3400).
# - ProjectInfo.leaves: the project attribute 'leaves' (Project.rb:86), a
#   LeaveList in parse order: global `leaves` (TjpSyntaxRules.rb:3595-3599)
#   and `vacation`, which is stored as :holiday (TjpSyntaxRules.rb:3666-3670).
#   Each Leave (LeaveList.rb) has a type, an Interval as written (not clipped
#   to the frame) and a reason, which is the name.
#   T6: TaskJuggler 3.8.4 never keeps a leave's name: rule_leave passes the
#   result of rule_vacationName, which has no action ("We just throw the name
#   away", TjpSyntaxRules.rb:2301-2305, 7498-7502), so every reason is nil and
#   every name is null. The serializer still reads the reason, so the field
#   needs no schema change if a later bridge captures names; until then the
#   names are in the text (the symbol index's LeaveSite items).
#   T6: a plan that failed to parse gets [] (as for workingTime), not the
#   leaves its header collected before the error: its tasks and resources
#   are empty too.
# - ResourceScenarioResult.workingTime and leaves: the resource scoreboard
#   (ResourceScenario.rb:22-37 for the slot encoding, initScoreboard at
#   830-910). workingTime holds the slots ResourceScenario#getWorkSlots counts
#   (nil or a Task, 783-789); leaves the slots #getLeaveSlots counts for each
#   type (an Integer with bit 1 clear and the type in bits 2 to 5, 792-797).
#   Read in the same single pass as the bookings; #scan_scoreboard says why it
#   is raw.
#   TaskJuggler builds a scoreboard only for the leaf resources some task can
#   use, when it prepares a scenario (Project#prepareScenario,
#   Project.rb:1073-1088). For the others, and in a scenario an earlier error
#   kept scheduling from reaching, #unused_scan computes the lists from what
#   that scoreboard would be built from, once per distinct working hours and
#   leaves (building one per person was the T6 review's 3.8 s). Groups have
#   no scoreboard: both lists are [].
#   T6: workingTime is null when it equals ProjectInfo.workingTime exactly
#   (main-session ruling at the T6 review): most people work the project's
#   hours, and the lists doubled the result.
# - TaskScenarioResult.allocate: the scenario attribute 'allocate'
#   (Project.rb:245, AllocationAttribute, inherited), one entry per
#   Allocation with its candidates as the parser added them: the resource
#   written first, then each `alternative` (TjpSyntaxRules.rb:261-265,
#   372-375). Allocation keeps that list in @candidates; its public
#   #candidates returns the list sorted by the selection mode once scheduling
#   has cached one (Allocation.rb:75-78, 123), so the list is read directly.
require 'json'

module MainspringBridge
  # Raised when the serializer meets data it cannot represent exactly, such as
  # a date that is not a whole number of minutes after the project start.
  class SerializeError < StandardError; end

  class Serializer
    ANSI_RE = /\e\[[0-9;]*[A-Za-z]/.freeze
    LEVELS = %i[fatal error warning info debug].freeze
    # One leaf resource's scoreboard in one scenario, as slot runs (#scan_scoreboard).
    Scan = Struct.new(:working, :leaves, :runs)

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
      @size = project.scoreboardSize
      # The last index of a resource Scoreboard over the frame (Scoreboard.rb:
      # its size is ceil(frame / granularity) + 1), where dateToIdx clamps.
      @sbLast = ((project['end'] - project['start']) / project['scheduleGranularity']).ceil
      # { scenarioIdx => { leaf Resource => Scan } }, filled by #resource and
      # read by #bookings, so each scoreboard is read once.
      @scans = Hash.new { |h, k| h[k] = {}.compare_by_identity }
      # A leaf's workingTime is null when it is exactly this list (see #resource).
      @projectWorkingTime = info['workingTime']
      # #unused_scan's caches: on-shift runs per distinct WorkingHours, and the
      # Scan per distinct (working hours, shifts, own leaves); #resource's
      # output per Scan, so a Scan shared by many people is converted once.
      @onShiftRuns = []
      @unusedScans = []
      @scanOutput = {}.compare_by_identity
      @globalLeaves = project['leaves'].map { |l| leave_slots(l) }

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
        'workingTime' => scheduled ? working_time(p) : [],
        # v3 (phase-3 spec 6.1); sources in the header comment.
        'weekStartsMonday' => p['weekStartsMonday'] ? true : false,
        'leaves' => scheduled ? project_leaves(p) : []
      }
    end

    # The global leaves as TaskJuggler holds them, in parse order, bounds as
    # written (they may lie outside the frame). Dates are aligned to the
    # timing resolution (TjpSyntaxRules.rb:912-923, 2038-2068), so #minutes
    # accepts them.
    def project_leaves(p)
      p['leaves'].map do |leave|
        iv = leave.interval
        { 'type' => leave.type.to_s, 'name' => leave.reason,
          'interval' => [minutes(iv.start), minutes(iv.end)] }
      end
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
          'precedes' => dependencies(t, t['precedes', idx]),
          # v3 (phase-3 spec 6.1): what the task asked for, in TaskJuggler's
          # order; groups stay groups (TaskScenario#candidates expands them
          # only for booking). Sources in the header comment.
          'allocate' => t['allocate', idx].map do |a|
            { 'candidates' => a.instance_variable_get(:@candidates).map(&:fullId) }
          end
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
        rs = { 'efficiency' => r['efficiency', idx], 'workingTime' => [], 'leaves' => [] }
        unless r.container?
          scan = (@scans[idx][r] = resource_scan(r, idx))
          rs['workingTime'], rs['leaves'] = (@scanOutput[scan] ||= scan_output(scan))
        end
        scenarios[id] = rs
      end
      {
        'id' => r.fullId, 'name' => r.name,
        'parent' => r.parent && r.parent.fullId,
        'source' => source_ref(r.sourceFileInfo),
        'group' => r.container? ? true : false,
        'scenarios' => scenarios
      }
    end

    # EngineLeaveType names by scoreboard index (Leave::Types, LeaveList.rb:
    # project 1 to unemployed 7); index 0 means no leave and is nil.
    def leave_names
      @leaveNames ||= TaskJuggler::Leave::Types.each_with_object([]) do |(type, i), names|
        names[i] = type.to_s
      end
    end

    # The Scan of leaf _r_ in scenario _idx_: its scoreboard when TaskJuggler
    # built one, else #unused_scan.
    def resource_scan(r, idx)
      rs = r.data[idx]
      return scan_scoreboard(rs) if rs.instance_variable_get(:@scoreboard)

      unused_scan(r, idx, rs)
    end

    # [workingTime, leaves] of a Scan as the result holds them.
    def scan_output(scan)
      working = slot_minutes(scan.working)
      leaves = leave_names.each_with_index.filter_map do |name, typeIdx|
        runs = scan.leaves[typeIdx]
        { 'type' => name, 'intervals' => slot_minutes(runs) } if name && runs
      end
      # T6: ruling of the main session at the T6 review (2026-11-16): null
      # means "the same as ProjectInfo.workingTime", which most people's
      # lists are, so the result stays small.
      [working == @projectWorkingTime ? nil : working, leaves]
    end

    # A leaf TaskJuggler built no scoreboard for: no task can use it in this
    # scenario, or scheduling never reached the scenario (see the header). It
    # has no bookings, so its lists follow from what initScoreboard
    # (ResourceScenario.rb:830-910) reads: its working hours or shifts, the
    # global leaves and its own leaves. Building that scoreboard costs one
    # onShift? call per slot of the frame and resource (T6 review: 199 unused
    # people on a 1-year frame at 15 minutes took 3.8 s in the browser engine),
    # so the lists are computed from those inputs instead, once per distinct
    # (working hours, shifts, own leaves). The key holds everything
    # initScoreboard reads besides the project's own data, so one entry serves
    # every scenario with the same inputs.
    #
    # Without shifts, initScoreboard gives a slot inside the working hours
    # (WorkingHours#onShift?) that k global leaves (project 'leaves') and some
    # own leaves (the resource's 'leaves', copies of earlier global leaves
    # included) cover:
    #   - k = 0: nil (working time), unless an own leave covers it: then the
    #     highest own type with bit 1 clear (850-868: a nil slot takes the
    #     first own type, later ones only raise it);
    #   - k = 1: that global's type with bit 1 clear (847), raised to the
    #     highest own type;
    #   - k >= 2: bit 1 set, because the second global reads the first one's
    #     value as not nil (847); own leaves keep that bit, so off hours.
    # A slot outside the working hours starts as 2 and keeps bit 1: off hours.
    # Leave ranges are Scoreboard#dateToIdx's, clamped to the scoreboard.
    # engine/golden/check-unused-scan.rb compares this, natively, with the
    # scoreboard TaskJuggler builds, slot by slot; the load cross-check of
    # record-native.mjs checks the result against tj3's reports too.
    #
    # With shifts, or working hours whose own scoreboard is not the frame's,
    # the resource's scoreboard is built instead (#scan_scoreboard), also once
    # per distinct key. Working hours compare with WorkingHours#==, shifts by
    # ShiftAssignment#hashKey (the shift scenario and the interval, the key
    # TaskJuggler itself shares shift scoreboards by, ShiftAssignments.rb:
    # 30-32, 244-272), own leaves by type and slot range.
    def unused_scan(r, idx, rs)
      wh = r['workinghours', idx]
      shifts = r['shifts', idx]
      shiftKey = shifts && shifts.assignments.map(&:hashKey)
      own = r['leaves', idx].map { |l| leave_slots(l) }
      hit = @unusedScans.find { |w, s, o, _| s == shiftKey && o == own && w == wh }
      return hit[3] if hit

      runs = shifts.nil? && on_shift_runs(wh)
      scan = runs ? classify_unused(runs, own) : scan_scoreboard(rs)
      @unusedScans << [wh, shiftKey, own, scan]
      scan
    end

    # [typeIdx, first slot, stop slot] of a Leave, as initScoreboard loops over
    # it: Scoreboard#dateToIdx of its start and end, clamped to [0, @sbLast].
    def leave_slots(leave)
      iv = leave.interval
      [leave.typeIdx, scoreboard_idx(iv.start), scoreboard_idx(iv.end)]
    end

    def scoreboard_idx(date)
      ((date - @project['start']) / @project['scheduleGranularity']).to_i.clamp(0, @sbLast)
    end

    # The slot runs where WorkingHours#onShift? is true, read from the
    # true/false scoreboard WorkingHours keeps (WorkingHours.rb:144-151,
    # 209-240; equal copies share it), once per distinct working hours. False
    # when that scoreboard does not line up with the frame's slots.
    def on_shift_runs(wh)
      return false unless wh

      hit = @onShiftRuns.find { |w, _| w == wh }
      return hit[1] if hit

      runs = false
      if wh.startDate == @project['start'] && wh.slotDuration == @project['scheduleGranularity']
        wh.onShift?(0) # builds the scoreboard if it has none (public)
        sb = wh.scoreboard
        if sb.size >= @size
          runs = []
          first = nil
          i = 0
          while i < @size
            if sb[i]
              first ||= i
            elsif first
              runs << [first, i]
              first = nil
            end
            i += 1
          end
          runs << [first, @size] if first
        end
      end
      @onShiftRuns << [wh, runs]
      runs
    end

    # The Scan of #unused_scan without shifts: the on-shift _runs_ cut by the
    # leave ranges, each piece classified by the rules above.
    def classify_unused(runs, own)
      out = Scan.new([], {}, {}.compare_by_identity)
      cuts = [0, @size]
      (@globalLeaves + own).each do |_, first, stop|
        cuts << first << stop if first < stop && first < @size
      end
      cuts = cuts.map { |c| c > @size ? @size : c }.uniq.sort
      # [first, stop, class]: class 0 is working time, nil off hours, else the
      # leave type.
      segments = cuts.each_cons(2).map do |a, b|
        k = 0
        type = 0
        @globalLeaves.each do |t, first, stop|
          next unless first <= a && a < stop

          k += 1
          type = t
        end
        own.each { |t, first, stop| type = t if first <= a && a < stop && t > type }
        [a, b, k >= 2 ? nil : type]
      end
      j = 0
      runs.each do |first, stop|
        j += 1 while segments[j][1] <= first
        a = first
        while a < stop
          seg = segments[j]
          b = seg[1] < stop ? seg[1] : stop
          if (cls = seg[2])
            add_run(cls.zero? ? out.working : (out.leaves[cls] ||= []), a, b)
          end
          j += 1 if b == seg[1]
          a = b
        end
      end
      out
    end

    # One leaf resource's scoreboard in one scenario, classified slot by slot
    # in a single pass, as [first, stop) slot runs:
    #   working: free or booked slots (getWorkSlots, ResourceScenario.rb:783-789);
    #   leaves:  { typeIdx => runs } for Integer slots with bit 1 clear and a
    #            leave type in bits 2 to 5 (getLeaveSlots, ResourceScenario.rb:792-797);
    #   runs:    { Task => runs } for booked slots (see #bookings).
    # Other Integer slots are off hours, or leave outside working hours.
    #
    # The pass is raw for speed (spec 6.1, "Rules for the bridge"): ResourceScenario
    # has no reader for its scoreboard, and its public per-slot readers (bookedTask,
    # booked?, available?) cannot tell free time from leave or off hours, while the
    # counting methods (getWorkSlots, getLeaveSlots) give totals, not intervals, at
    # eight scans per resource. So the scoreboard is read once through
    # @scoreboard and its public Scoreboard#[]. Equal neighbours are skipped with
    # equal? (slot values are nil, a Task or an Integer, all compared by identity
    # here, which is value equality for Integers), so the classification runs once
    # per run of equal slots; Integer#!= against a Task takes Ruby's recursion guard
    # under ruby.wasm (see #bookings). Slots from scoreboardSize on are never read:
    # initScoreboard and #book never write them (they stay 2, off hours).
    def scan_scoreboard(rs)
      sb = rs.instance_variable_get(:@scoreboard)
      unless sb
        # Only #unused_scan's fallback gets here: the public counter builds
        # the scoreboard, as TaskJuggler's reports do.
        rs.getWorkSlots(0, 1)
        sb = rs.instance_variable_get(:@scoreboard)
      end
      out = Scan.new([], {}, {}.compare_by_identity)
      size = @size
      return out if size <= 0

      cur = sb[0]
      first = 0
      i = 1
      while i < size
        v = sb[i]
        unless v.equal?(cur)
          classify(out, cur, first, i)
          cur = v
          first = i
        end
        i += 1
      end
      classify(out, cur, first, size)
      out
    end

    def classify(out, value, first, stop)
      if value.nil?
        add_run(out.working, first, stop)
      elsif value.is_a?(Integer)
        # (value & 0x3E) == typeIdx << 2, as getLeaveSlots tests it.
        if (value & 0x2).zero? && !(type = (value & 0x3C) >> 2).zero?
          add_run(out.leaves[type] ||= [], first, stop)
        end
      elsif value.is_a?(TaskJuggler::Task)
        add_run(out.working, first, stop)
        (out.runs[value] ||= []) << [first, stop]
      end
    end

    # Appends [first, stop) to _runs_, extending the last run it touches.
    def add_run(runs, first, stop)
      if (last = runs.last) && last[1] == first
        last[1] = stop
      else
        runs << [first, stop]
      end
    end

    # Slot runs as minute pairs: Project#idxToDate(i) is start + i * granularity
    # (Project.rb:951-956), so slot i is minute i * timingResolutionMin.
    def slot_minutes(runs)
      runs.map { |s, e| [s * @slotMin, e * @slotMin] }
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
    # a scan of its own. Since v3 the runs come from #scan_scoreboard, the
    # same pass that reads workingTime and leaves. The output is unchanged
    # (golden:verify and the wasm golden run both match).
    def bookings(_project, resources)
      out = []
      # Scanning scoreboardSize slots is enough: Scoreboard allocates ceil(...)+1 slots and
      # never sets slots >= scoreboardSize to nil, so available? is false there, and booking
      # indices stop at endIdx-1 <= scoreboardSize-1.
      @active.each do |scenarioId, idx|
        resources.each do |r|
          # Only leaf resources hold bookings, and #resource scanned every
          # leaf. ResourceScenario#book adds the task to the resource's duties
          # before it books a slot, so a leaf without duties has no runs.
          next if r.container?

          runs = @scans[idx][r].runs
          runs.keys.sort_by { |t| @taskRank[t] }.each do |t|
            out << { 'scenario' => scenarioId, 'resource' => r.fullId,
                     'task' => t.fullId, 'intervals' => merge(slot_minutes(runs[t])) }
          end
        end
      end
      out
    end

    # _pairs_ ([start, end] minutes, ascending by start) with touching or
    # overlapping pairs merged. #scan_scoreboard already returns ascending runs.
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
