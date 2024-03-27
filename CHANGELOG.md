# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Renaming a `ruleId` is a breaking change and is recorded here.

## [0.1.0]

### Added

- A source map from every dashboard tile to its query, the models that query
  reads, the transformation behind each model and the freshness evidence the
  export declares, written to the path named by `--out`.
- Broken-link reporting: a tile naming a query its dashboard does not declare, a
  query naming a model nothing provides, and a model naming an upstream nothing
  provides.
- Rename handling. A model's former ids are honoured, every impacted tile is
  named in the report, and a former id claimed twice — or claimed while still
  live — is reported as ambiguous rather than resolved to one candidate or
  downgraded to "missing".
- Format handling. `edilec.dashboard/v1` and `edilec.model-export/v1` are read;
  any other declared format, or none, is reported by name and contributes no
  tile, no query and no model edge.
- Freshness recorded as an explicit `unknown` where an export declares none,
  never omitted and never judged against a clock.
- A destination guard on `--out` covering a symbolic link at the destination and
  a hard link to any file the run resolved, including files it only listed. The
  destination is deliberately not confined to `--root`, and the help text and
  README say so.
- Declared bounds on document bytes, directory entries, dashboard files, tiles,
  queries, models, query references, upstream ids, previous ids, findings,
  identifier length, text length and tile-to-model edges across the whole run,
  enforced before the work.

### Fixed

- A schema refusal that records no problem is now pinned as a refusal.
  `compileDashboard` returns `ok` when the problem list is empty, so deleting
  the `problems.add` inside `checkKeys` or `cleanString` — both silent — made a
  tile that is not an object, or an id that is the empty string, compile into a
  dashboard with `"id": null` in the written map at exit 0. An empty `format`
  string and an over-long unsupported format are pinned too: the first declares
  no format rather than an unsupported one, and the second is cut at the excerpt
  bound rather than echoed whole.
- Two guards against untrusted text in the report are pinned by inputs that
  reach them. The test named for the parse-failure backstop passed without it —
  its invented wording matched no branch, so the generic fallback answered and
  the backstop was never consulted; a message that reaches the position branch
  *and* still carries a quoted span now drives it. And V8 quotes the offending
  character of a document verbatim, so an export beginning with U+202E put a
  right-to-left override into the finding message: `ReportBuilder.add`
  sanitising the message is the only thing that strips it, and removing that one
  call was silent.
- `summary.checked` counts the dashboard exports the run opened, not the ones
  the listing offered. With the new edge limit the difference became visible and
  dishonest: a run that stopped after two files reported `checked: 200` beside
  `dashboards: 2`. What every summary field counts is now written down in the
  README, which had documented none of them.
- Serialising the map and writing it are reported separately. Both calls sat
  inside one `try`, so a map too large for a single JavaScript string — which a
  caller reaches by raising `--max-tile-model-edges` — came out as `--out could
  not be written (unknown error)`: the wrong act, and nothing the reader can do
  about it. The size case now names itself and names the limit to lower. The
  write failure itself is now driven end to end through the real CLI, which no
  test had done: exit 2, empty stdout, `(EACCES)`, no stack trace and no
  absolute host path.
- A legal input no longer exhausts memory. Every declared bound bounded one
  document, and their product — 200 files x 500 tiles x 100 references — is ten
  million lineage edges, each of which becomes an object in the map and several
  hundred bytes of the written document. A tree at exactly the documented
  maximum produced `FATAL ERROR: Ineffective mark-compacts near heap limit`,
  exit 134, empty stdout, 4.45 GB peak RSS and 460 s — the outcome the module
  comment in `limits.mjs` claimed these bounds existed to prevent. The new
  `maxTileModelEdges` (default 100000, `--max-tile-model-edges`) bounds the run
  itself: it is checked against each dashboard before that dashboard's edges are
  built, and stops with `edge-limit-reached` naming the exports that were not
  mapped. The same tree now finishes in 8.3 s at 514 MB with a report saying
  which 198 exports it did not read, and a tree at the new documented maximum —
  200 exports of 668 KB, 100000 tiles, 100000 edges, 5000 models, every
  identifier and title at its own limit — exits 0 in 5.4 s at 1.21 GB peak RSS,
  writing a 189 MB map. Those measured figures are what the README, the help
  text and the limit's own comment now quote.
- Five more ordering call sites are pinned behaviourally: the directory listing,
  a query's model references, a model's former ids, the claimants named in an
  ambiguity message, and the pointer key of the finding comparator. Giving any
  of them an `Intl.Collator` changed real output with the suite green. The
  message tiebreak in the comparator is pinned too, by a query declaring two
  unresolved sources out of order. The one remaining site — the rule-id key — is
  named as an equivalent mutant with the reason: no two ids in the frozen table
  are ordered differently by code unit and by collation, and a test fails if one
  ever is.
- The schema's uniqueness and required-key guards are pinned behaviourally.
  Deleting the duplicate check in `uniqueIds`, the duplicate check in
  `identifierList`, or the required-key loop in `checkKeys` left the whole suite
  green, while two tiles sharing an id collapsed into one `usedByTiles` entry,
  two queries sharing an id sent every tile behind the second one to the first
  one's models, two models sharing an id resolved to whichever came later, and a
  model claiming one former id twice was reported as `rename-ambiguous` between
  a model and itself — a finding at error severity naming no second claimant.
- Every configuration-error test pins which refusal fired. The table asserted
  only the shape — exit 2, empty stdout, a stderr prefix — so each of its eight
  cases was satisfied by a different error: with the unknown-option guard
  removed `--verbose` fell through to "needs a value", and with the numeric
  guard removed `lots` fell through to "at least 1". Both were silent. A
  one-character typo in a bound name (`--max-tile`) is now a case of its own,
  because that is the failure the guard exists for.
- Strict UTF-8 decoding is pinned by a test. `fatal: true` was the only thing
  refusing an undecodable byte, and nothing drove it: substituting
  `fatal: false` left the suite green while a dashboard export holding a lone
  continuation byte became `status: "pass"`, exit 0, `source-map-complete`, with
  its dashboard id silently rewritten around a replacement character. A
  companion test pins the other side — a document that legally contains U+FFFD
  is read, mapped and exits 0 — because that is the case a "look for U+FFFD in
  the decoded text" guard gets wrong.
- Control, bidi and line-separator characters no longer reach the written source
  map. The report on stdout was built through a sanitising constructor, but the
  map is serialised with `JSON.stringify`, which escapes neither the C1 range
  nor U+2028/U+2029 nor any bidi control — and two fields never passed through
  the sanitiser at all: the `declaredFormat` of an unsupported export, and every
  `file` path, which comes from the directory listing. A directory entry whose
  name carries one of those characters is now refused as `path-unrenderable`,
  named by the code points it carries, and read no further; `--dashboards` and
  `--models` are refused for the same reason as a configuration error. The
  sanitisation suite now asserts on the bytes of the file named by `--out`,
  which is what its header always claimed.
- Path confinement is applied per file. A symbolic link planted among the
  dashboard exports was followed out of the declared root, its content compiled
  into the map, and the map named it by its in-root path — a false claim about
  where the evidence came from, at exit 0. Every listed export now has its real
  path resolved and asserted to be inside the real root before it is opened, and
  one outside it is reported as `path-outside-root` and read from no further.
- An ambiguous former id is reported as ambiguous even when it is also a live
  model id. The live table was consulted before the ambiguity table, so the live
  model silently won the collision: the tile came out `resolved`, via `id`, with
  no tile-level finding, while the report beside it said references to that id
  resolve neither way. The test named for this case never inspected the tile.
- `source-map-complete` is derived from the map it describes. It was computed
  from finding severities alone, which was right only because every unresolved
  reason happens to carry a non-info finding; deleting one `report.add` made the
  completion claim fire beside `unresolvedTiles: 2`. Both `models-invalid`
  branches — an unsupported model-export format and an undeclared one — now have
  tests that fail when the refusal is removed.
- The `source-map-complete` row of the README rule table no longer claims every
  tile resolves to a *transformation*. A raw source is not produced by one, and
  the finding message was corrected for that in an earlier commit while the
  table was left behind.
- A query's declared `unresolvedSources` survives a run that could not read the
  model export. It was dropped from both the report and the map, leaving a
  consumer with only `model-export-unavailable` and the conclusion that the tile
  would resolve once the model export was fixed.
- Two export files declaring one `dashboardId` are reported as
  `dashboard-id-duplicated` and the second contributes no lineage. The map keys
  `models[].usedByTiles` by `dashboardId/tileId`, so two files claiming one id
  collapsed two different tiles into one key: the entry could not be resolved
  back to a file, the count of tiles reaching a model under-reported, and the
  map contradicted its own `dashboards[]` list.
