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
