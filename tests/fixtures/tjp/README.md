<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
# TJP edge fixtures (Phase 1, T16)

Small plans for the grammar, round-trip, index and edit suites (phase-1.md 5.1, 5.4, 9.1, 9.3).
Each folder holds `plan.tjp` plus any `.tji` it includes. Every file starts with a `# Feature:`
comment and an SPDX header. Line endings, tabs and the BOM are significant, so
`.gitattributes` marks `tests/fixtures/tjp/**` as `-text`. Do not reformat these files.

Native check, run from the fixture folder with the engine stubs and the TaskJuggler 3.8.4
sources under `engine/` on the load path, `--no-reports --silent plan.tjp`, `TZ=UTC`,
`LANG=C.UTF-8`. The check writes nothing into the repo.

| Fixture | Exercises | Native result |
| --- | --- | --- |
| `macro-ids` | Macro calls as task and resource ids (`task ${tid}`, `${who}2`), templated names, macro in `depends`/`allocate` (X2, X4) | accepted (exit 0) |
| `macro-statements` | Statement-level macro calls in task bodies, multi-line macro body, `${?absent}` as a statement (`macro-in-body`) | accepted (exit 0) |
| `macro-expanded` | A resource and tasks declared only through statement-level macro calls with arguments (X5), a dependency and an allocation naming them | accepted (exit 0); ids `top`, `top.q1`, `top.lit`, `top.q2`, `after` and resource `ana` checked with temporary `taskreport`/`resourcereport` in a scratch copy; the wasm engine records lines 9, 10, 11, 14, 16 and 8 (the call lines) |
| `macro-args-nested` | Macro arguments `${1}`, quoted call args, optional `${?x}` (before a value), nested calls inside macro bodies, glued id `t${major}`, `${content}${major}` | accepted (exit 0) |
| `crlf-plan` | Whole file CRLF, header comment included | accepted (exit 0) |
| `crlf-strings` | CRLF with a multi-line string and a cut-here string | accepted (exit 0) |
| `crlf-macro` | Whole file CRLF with a multi-line and a one-line macro body closing on `]` before CRLF, used as a statement (`${e}`) and a value (`${who}`) | accepted (exit 0); `effort 3d` from the macro applies (checked with a temporary `export` in a scratch copy) |
| `cr-only` | Lone CR line breaks throughout (old Mac): macro body closing on `]` before CR, `#` and `//` comments, multi-line string | accepted (exit 0); the macro's `effort 3d` applies and the note has two lines (temporary `export`) |
| `crlf-comment` | LF file where a lone CR inside a `#` or `//` comment line ends the comment, so `effort 3d`/`effort 2d` after it is read | accepted (exit 0); both efforts apply (temporary `export`) |
| `tabs` | Tab indentation, tabs between tokens, trailing tabs | accepted (exit 0) |
| `one-line-blocks` | One-line blocks, several statements per line, empty body `{}`, project body on one line | accepted (exit 0) |
| `cut-here-strings` | `-8<-` ... `->8-` with comment-like text, braces, trailing blanks after the mark, inline `->8-` that does not close | accepted (exit 0) |
| `comments` | `#`, `//`, one-line `/* */` greedy to the last `*/` (swallows task `b` and the rest of that line), multi-line comment, nested-looking comment, comment closing before a statement (swallows task `d`) | accepted (exit 0) |
| `comments-in-strings` | `#`, `//`, `/* */` inside strings, `\"` and `\\` escapes, single-quoted string with `\'`, multi-line string | accepted (exit 0) |
| `relative-ids` | `!sibling`, `!!parent`, `!!!`, absolute dotted ids, dependency bodies (`gapduration`, `onstart`) | accepted (exit 0) |
| `scenario-prefix` | Scenario declarations, `delayed:effort`, `delayed:priority`, `delayed:depends` | accepted (exit 0) |
| `supplement` | `supplement task` (attribute repeated, last wins; adds a child task), `supplement resource` (efficiency, vacation, workinghours) | accepted (exit 0); warning "Overwriting a previously provided value for attribute priority" is intended |
| `include-taskprefix` | `include "sub.tji" { taskprefix parent }`, prefixed ids referenced as `parent.sub1` | accepted (exit 0) |
| `include-resourceprefix` | `include "people.tji" { resourceprefix team }`, leaf id used in `allocate` | accepted (exit 0) |
| `include-nested` | Nested includes (`defs.tji` includes `leaf.tji`), macros defined in includes and used after them, task prefix include, resource prefix include in a separate statement | accepted (exit 0) |
| `include-prefix-property` | A prefixed include that declares a task and then includes another file: its tasks go under the inherited `@property` (`outer.leaf`), while an include before any task composes the prefix (`outer.mid.leaf2`); a template included under two prefixes, with a nested include read on both visits (`g1.t`, `g2.t`, `g1.n`, `g2.n`) | accepted (exit 0); ids checked with a temporary `taskreport` in a scratch copy |
| `bom-utf8` | Leading UTF-8 BOM and non-ASCII names (ADR-0002 #13) | rejected (exit 1): "Unexpected token" at line 1. Expected: native does not skip a BOM, the bridge strips it, and the parser must keep it as trivia |
| `numbers-dates` | `5d` as Integer + Identifier, `.5` float, date with time and zone, `36h`, `8.0` | accepted (exit 0) |
| `neg-unterminated-string` | NEGATIVE: unterminated string (error token to end of file) | rejected (exit 1), "Unexpected token 'A' found. Expecting :STRING" at line 5 |
| `neg-junk-after-cut` | NEGATIVE: junk after `-8<-` | rejected (exit 1), "The cut mark -8<- must be immediately followed by a line break." at line 7 |

Notes found while validating, useful for the tests that use these files:

- TaskJuggler reads every file through `forceUTF8Encoding`, which converts `\r\n` and a lone `\r`
  to `\n` before scanning (`encode('UTF-8', universal_newline: true)`, UTF8String.rb). So a
  CRLF macro body closes on `]\r\n`, a lone `\r` ends a line comment, and CR-only files work.
  Driving `ProjectFileScanner` on a raw string skips this conversion and behaves differently.
- Macro call arguments must be double-quoted strings. A call inside a call argument is not
  possible, so nesting appears in macro bodies only.
- A `${?x}` glued after a number (`1d${?x}`) breaks the native scanner, so the optional call
  is placed before the value.
- An optional call in a string after other macro calls derailed the native scanner in a trial, so it is only used as a value.
- `allocate` takes leaf resource ids even under `resourceprefix`.
- An `include` that carries both `taskprefix` and `resourceprefix` and defines tasks crashes
  native TaskJuggler, so the two prefixes are in separate includes.
