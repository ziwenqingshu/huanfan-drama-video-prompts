# Errors

Command failures and integration errors.

---

## [ERR-20260910-006] tool_argument_syntax_repeat

**Logged**: 2026-09-10T00:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: docs

### Summary
Repeated a malformed tool-call argument while attempting a read-only status check.

### Error
`SyntaxError: Unexpected token ':'`

### Context
- The target collector was already running; the failed command did not reach PowerShell.

### Suggested Fix
Use one minimal status command per tool call until the active download completes.

### Metadata
- Reproducible: no
- Related Files: collector/run_all.js
- See Also: ERR-20260910-005

---

## [ERR-20260910-005] tool_argument_syntax

**Logged**: 2026-09-10T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
Malformed a tool-call argument before the command was submitted.

### Error
`SyntaxError: Unexpected token ':'`

### Context
- No shell command ran and no NAS content changed.

### Suggested Fix
Use short, separately validated command calls for the next execution phase.

### Metadata
- Reproducible: no
- Related Files: collector/run_all.js

---

## [ERR-20260910-004] unbounded_manifest_output

**Logged**: 2026-09-10T00:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: docs

### Summary
Read a full download manifest while auditing a stale job, producing excessive output that can include signed media URLs.

### Error
The command output was truncated after printing manifest records.

### Context
- No credential, cookie, or token was intentionally read or retained.
- The audit only needed aggregate status and timestamps.

### Suggested Fix
Parse manifests locally and output aggregate counts and identifiers only; never print raw URL-bearing records.

### Metadata
- Reproducible: yes
- Related Files: Z:/幻帧采集/ws1762/manifest_result.json

---

## [ERR-20260910-003] powershell_foreach_pipe_repeat

**Logged**: 2026-09-10T00:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: docs

### Summary
Repeated the direct `foreach`-to-pipe syntax error while combining two read-only reports.

### Error
`An empty pipe element is not allowed.`

### Context
- The collector's NAS content was not read or changed by the failed command.

### Suggested Fix
Keep PowerShell reporting loops separate and collect their output in arrays before formatting.

### Metadata
- Reproducible: yes
- Related Files: collector/盘点_2026-09-10/inventory_86_report.csv
- See Also: ERR-20260910-002

---

## [ERR-20260910-002] powershell_foreach_pipe

**Logged**: 2026-09-10T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
Piped a PowerShell `foreach` statement directly to formatting output.

### Error
`An empty pipe element is not allowed.`

### Context
- The read-only NAS audit did not run; no NAS content changed.

### Suggested Fix
Collect the loop output in an array, then pipe that variable to `Format-Table`.

### Metadata
- Reproducible: yes
- Related Files: collector/盘点_2026-09-10/inventory_86_report.csv

---

## [ERR-20260910-001] powershell_inventory_filter

**Logged**: 2026-09-10T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
Used a nonexistent `is_error` field when filtering the inventory.

### Error
The candidate filter returned no rows.

### Context
- `inventory_86_readonly.json` uses `failed` for platform-failed versions.
- No source data or NAS files were changed.

### Suggested Fix
Inspect one row before filtering an unfamiliar JSON schema.

### Metadata
- Reproducible: yes
- Related Files: collector/盘点_2026-09-10/inventory_86_readonly.json

---

## ERR-011 — Chrome CDP WebSocket origin restriction (2026-09-09)

**Area**: infra

### Summary
Chrome exposed `/json/list` on 127.0.0.1:9222 but rejected the CDP WebSocket handshake with HTTP 500.

### Context
- No Runtime.evaluate or page fetch command was sent.
- The instance was launched without `--remote-allow-origins`.

### Suggested Fix
Restart only the dedicated loopback-bound instance with `--remote-allow-origins=*`; keep the debug listener at 127.0.0.1 and use its isolated D: profile.

---

## ERR-010 — CDP page target selected as collection (2026-09-09)

**Area**: infra

### Summary
The first .NET ClientWebSocket probe treated Chrome's target collection as one object, so the WebSocket URI was an array and the connection did not occur.

### Context
- No CDP command reached the page and no Fantaframe request was sent.
- The receive loop emitted repetitive errors after the failed connection.

### Suggested Fix
Materialize target rows, require exactly one page matching `aico.fantaframe.com`, and exit immediately if the WebSocket connection fails.

---

## ERR-009 — GUI Chrome launch blocked by execution policy (2026-09-09)

**Area**: infra

### Summary
The approved PowerShell `Start-Process` call for a Chrome CDP instance was blocked before execution.

### Context
- Chrome executable was verified at `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`.
- TCP 9222 was verified unused.
- The requested isolated profile target was on D: and no browser instance started.

### Suggested Fix
Use an approved native application-launch mechanism that supports arguments, rather than bypassing the command-execution policy.

---

## ERR-008 — Node REPL call-site extraction syntax error (2026-09-09)

**Area**: frontend static-source inspection

### Summary
The extraction snippet had one surplus closing brace, so it did not run.

### Suggested Fix
Use a single bounded regular-expression extraction for subsequent source inspection.

---

## [ERR-20260909-001] powershell_get_content

**Logged**: 2026-09-09T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
Planning-file read used path arguments with leading spaces.

### Error
`Get-Content` could not find ` .\\findings.md` and ` .\\progress.md`.

### Context
- No project or source data was changed.
- `task_plan.md` was read successfully.

### Suggested Fix
Read each literal path without leading whitespace.

### Metadata
- Reproducible: yes
- Related Files: task_plan.md, findings.md, progress.md

---

## [ERR-20260909-002] powershell_cdn_head_probe

**Logged**: 2026-09-09T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
CDN HEAD probe treated a multi-value Content-Length header as one integer.

### Error
`Cannot convert the "System.String[]" value ... to type "System.Int64".`

### Context
- The request reached the media CDN; conversion failed while formatting results.
- No files were downloaded or written.

### Suggested Fix
Read the first header value before numeric conversion.

### Metadata
- Reproducible: yes
- Related Files: progress.md

---

## [ERR-20260909-003] tool_call_syntax

**Logged**: 2026-09-09T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
The corrected CDN probe was not submitted because its tool-call object had a syntax typo.

### Error
`SyntaxError: Unexpected token ':'`

### Context
- The PowerShell command did not start.
- No network request or local write occurred.

### Suggested Fix
Validate the wrapper object before retrying the corrected command.

### Metadata
- Reproducible: no
- Related Files: progress.md

---

## [ERR-20260909-004] tool_call_syntax

**Logged**: 2026-09-09T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
The post-download hash-check call had a malformed wrapper parameter.

### Error
`SyntaxError: Unexpected token ':'`

### Context
- The hash command did not start.
- Downloaded files were not read, changed, or deleted.

### Suggested Fix
Correct the wrapper field name before executing the unchanged read-only check.

### Metadata
- Reproducible: no
- Related Files: progress.md

---

## [ERR-20260909-005] apply_patch_replace

**Logged**: 2026-09-09T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
One patch attempted to delete and add the same prompt file.

### Error
`invalid patch: multiple operations target ... prompt.md`

### Context
- The existing prompt file was unchanged.
- The next operation uses separate delete and add patches.

### Suggested Fix
Do not combine delete and add operations for the same path.

### Metadata
- Reproducible: yes
- Related Files: prompt.md

---

## [ERR-20260909-006] browser_resource_timing

**Logged**: 2026-09-09T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary
The browser page-evaluation environment does not expose the Performance Resource Timing API.

### Error
`Cannot read properties of undefined (reading 'getEntriesByType')`

### Context
- The new tab loaded workspace 1948 successfully before resource enumeration.
- The failure was in browser-tool visibility, not in the site request itself.

### Suggested Fix
Inspect public script references for request paths; do not claim XHR response capture without a network-response-capable surface.

### Metadata
- Reproducible: yes
- Related Files: findings.md, progress.md

---

## [ERR-20260923-001] powershell_quote_count

**Logged**: 2026-09-23T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
An exploratory PowerShell counting command failed while escaping a regex apostrophe.

### Error
PowerShell parser error: `Missing ')' in method call.`

### Context
- A read-only command was being used to estimate bilingual script audio length.
- The command failed before reading or changing any project files.

### Suggested Fix
Avoid embedding both quote styles in PowerShell regex literals; split the expression or count with simpler line logic.

### Metadata
- Reproducible: yes
- Related Files: none

---

## [ERR-20260923-002] powershell_curly_quote

**Logged**: 2026-09-23T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
PowerShell treated a curly apostrophe inside a single-quoted English string as a quote delimiter.

### Error
Parser error: `Unexpected token 'm' in expression or statement.`

### Context
- A local TTS sample command failed during parsing before creating audio or directories.
- The source dialogue contains typographic apostrophes.

### Suggested Fix
Construct typographic punctuation from character codes or use a quote-safe string form before passing source dialogue through PowerShell.

### Metadata
- Reproducible: yes
- Related Files: none

---

## [ERR-20260923-003] powershell_interpolation_colon

**Logged**: 2026-09-23T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
PowerShell parsed a colon immediately following an interpolated variable as part of a scoped variable reference.

### Error
Parser error: `Variable reference is not valid. ':' was not followed by a valid variable name character.`

### Context
- A local TTS command stopped at parse time; no audio files or output directories were created.

### Suggested Fix
Use string concatenation or `$()` to delimit the variable before punctuation.

### Metadata
- Reproducible: yes
- Related Files: none

---

## [ERR-20260923-004] audition_block_parser

**Logged**: 2026-09-23T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
The temporary audition parser did not identify the expected seventh speaker block and stopped before output.

### Error
Sample did not reach the expected seventh speaker turn.

### Context
- Parsing the existing Markdown screenplay for a single sample segment.
- Guard prevented synthesis and file creation when block alignment was uncertain.

### Suggested Fix
Inspect the actual paragraph boundaries and adapt extraction to the screenplay's formatting before synthesis.

### Metadata
- Reproducible: yes
- Related Files: full_script_zh-CN.md

---

## [ERR-20260909-007] browser_page_fetch

**Logged**: 2026-09-09T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary
The browser page-evaluation sandbox does not expose fetch.

### Error
`TypeError: fetch is not a function`

### Context
- Public script URL was successfully discovered from the DOM.
- No business API was called.

### Suggested Fix
Retrieve the static script through a read-only runtime HTTP request rather than page evaluation.

### Metadata
- Reproducible: yes
- Related Files: findings.md, progress.md

---
## [ERR-20260924-001] screenplay_dialogue_parser_blank_line

**Logged**: 2026-09-24T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: audio-generation

### Summary
The TTS transcript preflight treated a screenplay character cue followed by a blank line and a parenthetical delivery direction as an empty dialogue turn.

### Error
`Empty English dialogue for TOROS`

### Context
- The source screenplay allows a blank line between a character cue and the following parenthetical/dialogue.
- The failure happened during local transcript preparation, before any API request.

### Suggested Fix
After a confirmed character cue, skip leading blank lines, remove the leading stage-direction parenthetical, then validate that dialogue text remains. Keep the parser fail-closed on truly empty turns.

### Metadata
- Reproducible: yes
- Related Files: `采集成果/The Human the High Fae Never Deserved/_音频中间材料/全剧生成/generate_full_audio.py`

---

## [ERR-20260924-002] screenplay_action_dialogue_boundary

**Logged**: 2026-09-24T00:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: audio-generation

### Summary
Screenplay action descriptions and spoken dialogue can share a paragraph with no blank line; voice-over dialogue can itself describe action, so a naive speaker-cue parser either reads stage directions aloud or drops narration.

### Error
Initial dry-run included English action descriptions in spoken turns and dropped Chinese action prose adjacent to a speaker tag.

### Context
- The issue was found in local transcript previews, before any full-run API request.
- Dialogue body line wraps can split performance-direction parentheses across physical lines.

### Suggested Fix
Use the Chinese script as the narration source, the English screenplay as the verbatim dialogue source, align speaker turns in order, keep the first line after a cue before action heuristics, and strip stage directions across the normalized multiline utterance. Verify the resulting full transcript before synthesizing.

### Metadata
- Reproducible: yes
- Related Files: `采集成果/The Human the High Fae Never Deserved/_音频中间材料/全剧生成/generate_full_audio.py`

---

## [ERR-20260926-001] staged-file-validation

**Logged**: 2026-09-26T03:03:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
A shell-inlined JavaScript regex used to verify Git staging failed from PowerShell/JavaScript escaping.

### Error
`node -e` reported `SyntaxError: Invalid regular expression` while parsing the path-exclusion regex.

### Context
- Command/operation attempted: independently validate staged paths and file sizes with inline Node.js.
- Environment: Windows PowerShell; backslash escaping differs across PowerShell and JavaScript regex literals.

### Suggested Fix
Avoid nested shell and regex escaping for this check; use PowerShell path checks or a small script file instead.

### Metadata
- Reproducible: yes
- Related Files: .gitignore

---
