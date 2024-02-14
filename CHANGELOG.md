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
  identifier length and text length, enforced before the work.

### Fixed

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
