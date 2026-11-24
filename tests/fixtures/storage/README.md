# Storage fixtures

Small plans whose bytes matter, for the storage tests (phase-4.md 13.1, 13.2; T20's recipe, made in
T5). Each schedules with no error in the wasm engine (`src/lib/storage/fixtures.engine.test.ts`). The
files are byte-exact inputs: `.gitattributes` marks them `-text` and `.prettierignore` leaves them
alone, so no line end or encoding is ever changed for them.

| Folder          | Bytes                                                                                                                     | For                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `bom-crlf/`     | `plan.tjp` starts with a UTF-8 byte order mark and every line ends in CRLF                                                | A round trip keeps both byte for byte (ADR-0003 #1)                                                          |
| `invalid-utf8/` | `notes.tji` (included by `plan.tjp`) has the byte `0xE9` (Latin-1 "é") in a comment                                       | `lossy` on read; never rewritten while unchanged; Export and Save to… say it gets replacement characters (18.11) |
| `nested/`       | `plan.tjp` includes `people/team.tji` and `work/phase1/tasks.tji`; `notes.txt` is not a plan file                         | Three files in nested folders (7.4): read, written and imported with their paths; other files never touched |
| `several/`      | `alpha.tjp` and `beta.tjp`, two plans in one folder                                                                       | The "which plan?" question, remembered per location (18.22)                                                   |

The two-device scenario plans of 16.1 are T20's and are not here yet.
