<!-- SPDX-License-Identifier: GPL-2.0-or-later -->

# Gesture library: the wiring contract (T9, for T16)

Pure, framework-free pointer gestures for the Gantt (phase-2.md 6.5, 7.2; ADR-0008 #4). The
library reads no DOM, no clock and no layout. T16 owns the DOM side; this file says exactly what it
must do. Nothing here edits a schedule: the outputs are previews and intents for `gantt/intents.ts`.

```
DOM events -> GestureInput -> createGestureController(env, cfg, hooks).send() -> GestureIntent[]
                                     (createGestureMachine underneath)
```

## 1. Feeding events

| DOM event                                                                                         | Input                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pointerdown`, `pointermove`, `pointerup`, `pointercancel`                                        | `{ type: 'down' \| 'move' \| 'up' \| 'cancel', id: pointerId, kind: pointerType, x, y, clientX, clientY, t: e.timeStamp, target, buttons: e.buttons, modifiers }` |
| `keydown` Escape                                                                                  | `{ type: 'escape' }`                                                                                                                                              |
| `lostpointercapture` (not one we caused), `visibilitychange` to hidden, `pagehide`, window `blur` | `{ type: 'reset' }`: back to idle from any state, with the cleanup outputs                                                                                        |
| a **user** scroll of the timeline                                                                 | `{ type: 'scroll', t }`                                                                                                                                           |
| the long-press timer                                                                              | `{ type: 'timer', t }`                                                                                                                                            |

- **Two coordinate systems.** `x`, `y` are content coordinates (scroll offset added, what `hitTest`
  takes). `clientX`, `clientY` are viewport coordinates. Drags use content coordinates, so a drag
  follows the content under auto-scroll. Slop, long-press tolerance, double tap, pinch and pan2
  use viewport coordinates, so a scroll under a still finger is not finger movement. Pinch and
  pan2 outputs are in viewport coordinates too.
- **`target`** is the hit under the pointer _now_ (call `hitTest` on every move, also while the
  pointer is captured, using content coordinates). On `down` it is where the press began. Pass
  `selected` to `hitTest` so a handle part (`end-handle`, `link-dot`, `progress`) is only ever
  returned for the selected bar.
- **`buttons`** is `PointerEvent.buttons`. A mouse or pen press needs exactly `1`: right click,
  middle click, the pen's barrel button and its eraser are ignored. Touch is not checked. A mouse
  or pen move with `buttons: 0` while a press is tracked is a lost release and cancels it.
- **Synthetic moves** (auto-scroll, below) must carry `buttons: 1`, or the lost-release check
  cancels the drag.
- **Timer.** After every `send`, read `timerAt`. If it is a number, `setTimeout` for
  `timerAt - now` and send `{ type: 'timer', t: now }`; if null, clear the timer. A late or lost
  timer is harmless: the machine fires a due long-press on the next event of any kind.
- **Forward only user scrolls.** The machine treats a `scroll` during a touch press, before the
  long-press fires, as the browser scrolling (the press goes native). Do not forward scrolls the
  app causes itself: auto-scroll, scroll in response to `pan2` or `pinch`, `scrollIntoView`,
  scroll anchoring. Compare `scrollLeft` and `scrollTop` with the last value the app set, or set a
  flag around programmatic scrolls.
- **Escape on a keyboard** is not the keyboard model. Every gesture has a keyboard equivalent
  (phase-2.md 7.1, 10.2); that is separate code on the same intents.

## 2. Acting on outputs and intents

- **`capture` / `release`** (`id`): `host.setPointerCapture(id)` and `host.releasePointerCapture(id)`.
  Capture on the **host element** that listens for the pointer events (the timeline `div` or
  `canvas`), never on an SVG child or an element that may be removed mid-drag. Guard both calls:
  `try { ... } catch {}`, and check `host.hasPointerCapture(id)` before releasing. `setPointerCapture`
  throws `NotFoundError` if the pointer is gone, and the browser releases capture by itself on
  `pointerup` and `pointercancel`, so a late `release` must not throw. When you release, ignore the
  `lostpointercapture` that follows (it is yours, not a reason to `reset`).
- **`claimsTouch`** (on the machine and the controller): call `preventDefault()` on `touchmove`
  **only while it is true**, from a non-passive listener that returns at once when it is false.
  It is true for a touch press that will drag at once (a selected bar's handle), a lifted item, a
  drag and a pinch, and false while a long-press is pending (the browser must stay free to scroll),
  after `pan-native`, and for mouse and pen. Set `touch-action: pan-x pan-y` on the host
  (phase-2.md 8.2).
- **`pan-native`**: stop forwarding to the machine's drag logic and do nothing else. Do not
  `preventDefault`. The `pointercancel` that follows is swallowed.
- **`long-press`**: lift the item (`navigator.vibrate?.(10)`). For a bar that cannot drag (a
  text-only row) the same intent opens the source sheet, and no drag follows.
- **`cancel`** (controller) / `drag-cancel` (machine): drop the preview, no edit. `reason` is one
  of `escape`, `reset`, `pointer-cancel`, `back-to-origin`, `second-pointer`, `lost-release`, and
  from the controller `no-change` (the snapped result equals the original) and `no-target`.
- **`drag-move` / `drag-end`** carry `time` for a move or a resize: `{ deltaMin, snappedMin, days }`.
  `days` is the whole working days of a move (what `GanttAction` `move` takes), null for a resize.
  `snappedMin` for a resize is what `GanttAction` `resize` takes as `end`. These are targets for the
  live label, not results (ADR-0007). The preview is visual only; the edit API runs once, at the
  drop (phase-2.md 7.3).
- **Link drags** report `link-start`, then on every move `link-move` (`x`, `y`: the rubber band),
  `link-hover` when the target bar changes (`target` is the bar or null; dry-run `addDepends` here,
  once per change, in an idle task), and `link-drop` (`from`, `to`) or `cancel`. A drop on the source
  bar is reported so the dispatcher can say `cycle`.
- **`pinch` and `pan2`** (viewport coordinates). `pinch.scale` is cumulative, 1 at the moment it
  engages (the dead zone is not a jump), measured on the **horizontal** finger gap (time runs left
  to right), and `(cx, cy)` is the centroid where the two fingers began. `pan2` is the incremental
  movement of the centroid. Combine them so the content point that was under the starting centroid
  stays under the moving centroid:

  ```
  anchorMin  = minute under cx at the start of the pinch   (scrollLeft0 + cx, through the scale)
  panX       = sum of pan2.dx since the start of the pinch
  pxPerDay   = pinchZoom(startPxPerDay, scale, MIN_PX_PER_DAY, MAX_PX_PER_DAY)
  scrollLeft = scrollLeftForAnchor(anchorMin, cx + panX, originMin, pxPerDay / 1440)
  ```

  With no pinch (`scale` never engaged) this is `scrollLeft0 - panX`: a plain two-finger pan.
  Vertical: `scrollTop = scrollTop0 - panY`. Do not re-anchor between frames and do not add the
  scroll you just did back into the input: the machine reads viewport coordinates for exactly that
  reason.

- **Edge auto-scroll** during a drag: each frame while `state === 'dragging'`, take
  `autoScrollVelocity(pointerClientX, viewport.left, viewport.right)` (and the same for y), scroll
  by `velocity * dt`, then send a synthetic `move` with the **same** `clientX`/`clientY`, the new
  content `x`/`y` (client plus the new scroll offset), a fresh `hitTest` target, `t: now` and
  `buttons: 1`. Do not forward the scroll event this causes.

## 3. Page-level settings T16 must add

- `contextmenu`: `preventDefault()` on the host. Android fires it on a touch long-press, which would
  open the menu over a lifted item.
- iOS: `-webkit-touch-callout: none`, `user-select: none` and `-webkit-user-select: none` on the
  host (no callout or text selection on long-press), and `preventDefault()` on Safari's
  `gesturestart` and `gesturechange` so the page does not zoom under our pinch.
- `touch-action: pan-x pan-y` on the host (the browser keeps one-finger scrolling, we own pinch).
- Hit areas are at least 24 px (fine) and 44 px (coarse), from `hitTest` (WCAG 2.5.8).

## 4. Snapping

`GestureEnv.snap` is a `DragSnapper`, built with `dragSnapperFromWorkingDays(wt)` from the working
time module's `shiftDays` (T4, `schedule/working-time.ts`, local calendar days). It is a branded
object, not a function, so `WorkingTime.snap` (snap to working _minutes_) cannot be passed by
accident. `calendarDragSnapper()` is for views with no working time and for tests.

- **move**: a whole number of working days from the original edge, `shiftDays(ref, days, 'start')`.
  Zero days is exactly no change, even for a mid-day edge, and the edge never moves against the
  pointer.
- **resize**: the nearest working-day end to the pointer, never on the opposite side of the original
  end from where the pointer went.
- `GestureEnv.edgeMin(bar, mode)` gives the dragged edge (start for `move`, end for `resize-end`);
  without it the pointer's own minute at the press stands in. The origin minute is read once, at the
  drag start, so a zoom or scroll mid-drag cannot move it.
- The adapter is tested against a stub that mirrors T4's semantics. **Rerun `snap.test.ts` against
  the real module when T4 merges** (swap the stub for `workingTimeFromPairs`).

## 5. Hooks

- `canDrag(hit)`: the dry run at drag start. A target that cannot drag (text-only, `macro-in-body`)
  still fires a touch long-press but never starts a drag.
- `isSelected(row)`: required for the touch rule. Without it no bar counts as selected, so the
  handles of a bar need the long-press (ADR-0008 #4: only a selected bar's handles drag at once).

## 6. Additions beyond phase-2.md 6.5

- `PointerInput.clientX`, `clientY` (viewport coordinates).
- Inputs: `scroll`, `reset`. Outputs: `pinch-end`, `capture`, `release`; `drag-move.atOrigin` and
  `.target`; `drag-cancel.reason`; `drag-end.target` and `.modifiers`; `tap` has `x`, `y` and
  `modifiers`.
- `GestureMachine.timerAt` and `.claimsTouch`.
- `GestureHooks.canDrag`, `.isSelected`.
- Controller intents: `drag-start`/`drag-move`/`drag-end` with `mode` (`move`, `resize-end`,
  `progress`, `row`), `dx`, `dy`, `time`; `cancel`; `link-start`, `link-move`, `link-hover`,
  `link-drop`; pass-through `tap`, `long-press`, `pan-native`, `pinch`, `pinch-end`, `pan2`,
  `capture`, `release`.
- Helpers: `autoScrollVelocity`, `scrollLeftForAnchor`, `pinchZoom`, `nearestBoundary`,
  `snapMoveDays`.

## 7. Rules in one place

Mouse and pen drag after 3 px (pen 4). Touch drags a selected bar's handle after 8 px and anything
else after a 350 ms long-press; moving more than 8 px first (or a user scroll) is a native scroll.
A drop within the slop of the origin, Escape, reset and pointercancel cancel. Only the first pointer
owns a press; a second touch cancels it and pinches; other second pointers and a third finger are
ignored. A double tap is two taps, press to press within 300 ms of the first release and 24 px, and a
drag, scroll or hand-over breaks the chain.
