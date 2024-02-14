# dashboard-source-map

Read dashboard exports and a model export, and say for every tile which query it
runs, which models that query reads, which transformation produced each model,
and what is known about each model's freshness. Broken links are the output, not
a side effect.

- **Repository:** [edilec/dashboard-source-map](https://github.com/edilec/dashboard-source-map)
- **Area:** Data & Analytics
- **License:** MIT

## Why it exists

Somebody renames a model. Nothing breaks that afternoon, because the warehouse
still has the old table; three weeks later a tile on a board nobody owns is
quietly wrong, and finding out which tiles were affected means opening every
dashboard by hand.

This tool answers that question from the exports themselves: which tiles read
which models, through which queries, produced by which transformations. It
names the impacted tiles, not just the impacted model.

The part that matters more than the mapping is what it refuses to do. A
dashboard export in a format this tool cannot read contributes **nothing** — not
a tile, not a query, not an edge. A rename the export records ambiguously is
reported as ambiguous and is **never** downgraded to "that model does not
exist". A run that could not read the model export does **not** then report
every tile as broken. A gap in a lineage graph reads as *no dependency*, and
that is the one thing a lineage graph must never say by accident.

## Quick start

```sh
# A pair of exports that resolves end to end.
node bin/dashboard-source-map.mjs --root examples/clean            # exit 0

# The same dashboards after a model was renamed, with the rename recorded.
node bin/dashboard-source-map.mjs --root examples/renamed          # exit 0, impacted tiles named

# The same rename with nothing recorded: a broken link.
node bin/dashboard-source-map.mjs --root examples/broken           # exit 1

# A dashboard exported from another tool, sitting beside a readable one.
node bin/dashboard-source-map.mjs --root examples/unsupported      # exit 2

# Write the map itself.
node bin/dashboard-source-map.mjs --root examples/clean --out /tmp/source-map.json
```

stdout carries the JSON report and nothing else. stderr carries a human summary;
`--quiet` turns it off. The source map is written only when `--out` is given.

## The exports it reads

A dashboard export, one file per dashboard, in `--dashboards` (default
`dashboards`):

```json
{
  "format": "edilec.dashboard/v1",
  "dashboardId": "revenue-weekly",
  "title": "Revenue, weekly",
  "tiles": [{ "id": "tile-arr", "title": "ARR", "queryId": "q-arr" }],
  "queries": [
    {
      "id": "q-arr",
      "description": "Monthly ARR",
      "modelIds": ["finance.arr_monthly"],
      "unresolvedSources": [{ "reason": "the table name is built at run time" }]
    }
  ]
}
```

A model export, at `--models` (default `models.json`):

```json
{
  "format": "edilec.model-export/v1",
  "models": [
    {
      "id": "finance.arr_by_month",
      "previousIds": ["finance.arr_monthly"],
      "upstreamIds": ["raw.subscriptions"],
      "transformation": { "id": "arr-rollup", "version": "2.2.0" },
      "freshness": { "observedAt": "2026-09-19T02:10:00Z", "source": "load-log" }
    }
  ]
}
```

Every key set is an allow-list: a key these schemas do not name is refused, not
ignored, so a typo in `queryId` cannot silently become a tile with no source.
`unresolvedSources` is how an export says *this query reads something I could
not name* — the tool records it rather than pretending the query's model list is
complete.

A query must declare at least one of the two. A query with neither says nothing
at all about what it reads, and a map recording the tile behind it as *resolved,
reads nothing* would assert something the export never said, so such an export is
refused with the pointer of the offending query.

## What it refuses to guess

### An unsupported format contributes nothing

This tool reads `edilec.dashboard/v1` and `edilec.model-export/v1`. A file
declaring any other format is reported **by the format it declares** and is not
compiled, not scanned, and never produces an edge — even when it happens to
carry a `tiles` array this tool could have read. "It has a tiles array" is not
the same claim as "this is an export of the format I understand", and only the
second one supports a lineage edge. A file declaring no format at all is treated
identically. Both make the run `incomplete` and exit `2`, and the file is listed
in the map's `unsupported` array with the format it declared.

Converting an export from another BI tool is out of scope; see Non-goals.

### An ambiguous rename is not a missing model

A model export can claim the same former id twice, or claim a former id that
another model still uses as its live id. The tempting implementation drops the
ambiguous entry while building the index and lets the lookup fall through — and
the lookup then answers *missing*, which is a positive claim that nothing
provides that id, made on evidence discarded a moment earlier.

Ambiguity is recorded instead. A reference to an ambiguous id is reported as
`rename-ambiguous`, the tile's lineage is `unresolved` — not `resolved`, not
`broken` — and the run is `incomplete`. Ambiguity is checked *before* the live
table, so an id that is both a live model and a recorded former id does not
quietly resolve to the live one. A model naming its own live id as a former id
is not a collision: exactly one model answers to that id either way.

### Without a model export, no tile is called broken

`model-missing` is a positive claim. A run that could not read the model export
has no basis for it, so it makes none: the model export is reported as
unreadable, every tile's lineage is `unresolved` with `model-export-unavailable`
recorded against it, and no tile is reported as broken. Reporting every tile as
broken because the index failed to load would be a finding raised on correct
input, which is the worst defect a checker can have.

### Freshness is reported, never judged

A model with no declared freshness is recorded as
`{"state": "unknown", "reason": "no-evidence-declared"}` — an explicit unknown,
never an omitted key, because a missing key reads as *no freshness concern
here*. The run still passes: the export was read in full and it simply declares
nothing, which is a different thing from evidence this tool failed to obtain.

This tool reads no clock, so it never says whether an observation is recent. See
Non-goals.

### A map of nothing is not a green run

A dashboard directory holding no export this tool can read is reported as
`no-dashboard-read` and exits `2`, rather than passing on zero evidence.

## Rules

| ruleId | severity | raised when |
| --- | --- | --- |
| `dashboard-file-skipped` | info | a directory entry is not a `.json` file, so it was listed and not read |
| `dashboard-format-undeclared` | error | a dashboard export declares no format; no lineage is read from it |
| `dashboard-format-unsupported` | error | a dashboard export declares a format this tool does not read; no lineage is read from it |
| `dashboard-invalid` | error | a supported-format dashboard does not match the schema; no lineage is read from it |
| `dashboard-unreadable` | error | a dashboard export could not be read, decoded or parsed |
| `finding-limit-reached` | warning | more findings were observed than `maxFindings` allows to be reported |
| `freshness-evidence-absent` | warning | a model a tile reads declares no freshness evidence; the map records unknown |
| `model-missing` | error | a query reads an id no model declares and no model claims as a former id |
| `model-renamed` | warning | a query reads an id the export records as a former id; the impacted tile is named |
| `model-unused` | info | no tile in any dashboard read by this run reaches this model |
| `models-invalid` | error | the model export declares an unsupported format or does not match the schema |
| `models-unreadable` | error | the model export could not be read, decoded or parsed |
| `no-dashboard-read` | error | the dashboard directory could not be listed, or holds no export this tool can read |
| `path-outside-root` | error | a dashboard export in the listing resolves outside the real root; nothing is read from it |
| `query-missing` | error | a tile names a query its dashboard does not declare |
| `query-source-unresolved` | warning | a query declares a source it could not name, so the tile's lineage is not complete |
| `rename-ambiguous` | error | a former id is claimed by two models, or is also a live id; references to it resolve neither way |
| `source-map-complete` | info | no tile is broken or unresolved: every tile resolves to a query its dashboard declares and to models the export provides, each with freshness evidence |
| `upstream-missing` | error | a model declares an upstream no model in the export declares |

Severity is taken from one frozen table in `src/rules.mjs` and an unknown rule id
throws. Renaming a rule id is a breaking change.

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | every tile read resolves end to end |
| `1` | at least one link is broken |
| `2` | invalid usage or an unusable destination (**empty stdout**), or evidence that could not be obtained (a report with `status: "incomplete"`) |

Exit `2` has two shapes, and a consumer piping stdout must handle both. A
configuration error means the run never had a subject, so there is nothing to
report about; an export that could not be read or recognised means the run had a
subject and failed to obtain evidence about it.

`incomplete` outranks `fail`: a run that could not read every export it was
pointed at has not established that the links it did read are the whole story.

A warning does not fail the run. `model-renamed` and `freshness-evidence-absent`
are visible at exit `0`; `query-source-unresolved` makes the run `incomplete`
because the export is telling you a dependency exists that it could not name.

## Limits

Every bound is enforced *before* the work: the directory listing is counted
before a file is opened, each document's size comes from `stat` before its bytes
are read, and every count is checked against the parsed document before the map
is built. Exceeding one is an `incomplete` result naming the limit, never a
silent truncation and never a pass.

| Limit | Default | Flag |
| --- | ---: | --- |
| `maxDocumentBytes` | 1048576 | `--max-document-bytes` |
| `maxDirectoryEntries` | 1000 | `--max-directory-entries` |
| `maxDashboardFiles` | 200 | `--max-dashboard-files` |
| `maxTiles` | 500 | `--max-tiles` |
| `maxQueries` | 500 | `--max-queries` |
| `maxModels` | 5000 | `--max-models` |
| `maxQueryReferences` | 100 | `--max-query-references` |
| `maxUpstreamIds` | 100 | `--max-upstream-ids` |
| `maxPreviousIds` | 20 | `--max-previous-ids` |
| `maxFindings` | 500 | `--max-findings` |
| `maxIdentifierChars` | 200 | (not overridable) |
| `maxTextChars` | 300 | (not overridable) |

## Determinism

Running the tool twice over identical inputs produces byte-identical stdout and
a byte-identical map. The directory listing is sorted by UTF-16 code unit before
anything is read, so filesystem enumeration order never reaches the output;
findings sort by `(location.file, location.pointer, ruleId, message)`; tiles,
models, upstream ids and tile-usage lists sort by code unit; and object keys in
the written map are ordered by code unit too.

`localeCompare` and `Intl.Collator` are not used anywhere: they read ICU data
that differs between Node builds, which would let two correct machines disagree.

## Writing the map

`--out` is checked before anything is written:

- a **symbolic link** at the destination is refused on sight, before anything is
  opened;
- a **hard link to any file this run resolved** — including one it only listed
  and never opened, such as a `NOTES.md` sitting in the dashboard directory, and
  including a dashboard whose format it refused — is refused, because `dev` plus
  `ino` is the only thing that sees it;
- the destination directory must already exist; this tool never creates one.

A refused destination is a configuration error: exit `2` with empty stdout.

`--out` is **not confined to `--root`.** It is an ordinary path, and a
symbolically linked parent directory is followed, exactly as it is for `cp` and
shell redirection. This tool declares no confinement root for its output and
does not pretend to: documenting a confinement the code does not perform reads
as coverage and is worse than saying nothing.

Declared input paths *are* confined, **per file and not per directory**.
`--dashboards` and `--models` are relative to `--root`, and every export the
listing discovers has its own **real** path resolved and asserted to be inside
the **real** root before it is opened. A symbolic link planted among the exports
is refused as `path-outside-root` and contributes no tile, no query and no model
edge, because a map that named it by its in-root path would be claiming that
evidence read from elsewhere came from this root.

## Non-goals

- **It does not parse SQL.** A query declares the models it reads. Nothing here
  reads query text, resolves a `SELECT *`, or infers a dependency from a string.
  A query that cannot name a source says so in `unresolvedSources`, and the tool
  reports that rather than filling the gap.
- **It does not convert exports.** Only the two formats above are read. There is
  no adapter for Looker, Tableau, Metabase, Superset or anything else, and a
  file from one of those is reported as unsupported rather than half-understood.
- **It connects to nothing.** No warehouse, no BI API, no network of any kind.
  Every input is a file somebody exported.
- **It does not judge staleness.** It reads no clock. `observedAt` is an opaque
  label copied verbatim and never parsed, so this tool cannot tell you a model
  is stale — only what the export says was observed.
- **It does not fix anything.** It writes one map to a path you name and edits no
  export.
- **It cannot see a dependency nobody declared.** The map is only as complete as
  the exports, which is why an unresolved source is reported rather than
  smoothed over.

## Development

```sh
npm run check      # lint, tests, a runnable example, and npm pack --dry-run
```

There are no runtime dependencies and no dev dependencies. Tests are `node:test`
with `node:assert/strict`.

## License

MIT. See [LICENSE](./LICENSE).
