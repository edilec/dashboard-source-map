# dashboard-source-map documentation

The README is the reference: it carries the export schemas, the rule table, the
exit codes, the limits and the non-goals. These notes record the decisions
behind them.

## Why an unsupported format contributes nothing

A dashboard export from another tool very often *looks* readable. It has an id,
a list of tiles, something query-shaped. Reading it anyway produces edges that
are right about the shape and wrong about the meaning, and a lineage edge that
is wrong is worse than one that is absent — somebody will act on it.

So the format is read first and on its own, before any structural validation,
and a file this tool does not recognise is listed by name with the format it
declared. It is never scanned for anything that happens to resemble a tile. The
run is `incomplete` rather than `fail`, because the honest statement is *there
is a dashboard here I could not read*, not *this dashboard is broken*.

## Why the model index records ambiguity instead of dropping it

The lookup has four answers and they are not interchangeable: resolved by live
id, resolved through a recorded rename, ambiguous, and missing. Only the last
one asserts that nothing provides the id.

Dropping an ambiguous entry while building the index makes the lookup return
*missing*, which turns discarded evidence into a positive claim. That exact
shape shipped elsewhere in this catalog: a tool dropped values it could not
evaluate out of an index, then asserted that a literal matched nothing in the
group and exited 0, while most of the candidates had been silently discarded.

So ambiguity is a state of its own, the tile's lineage is `unresolved`, and the
run is `incomplete`.

## Why a missing model export does not make every tile broken

`model-missing` is a claim about the world. A run that could not read the model
export has no basis for it, so it makes none. Reporting every tile as broken
because an index failed to load would be a finding raised at error severity on
correct input — the defect class that makes people stop reading a checker's
output altogether.

Tile-to-query resolution is self-contained and is still reported, because
nothing about it depends on the model export.

## Why freshness is unknown rather than absent, and never stale

A map with no freshness key for a model reads as *no freshness concern here*.
The map therefore records `{"state": "unknown", "reason": "no-evidence-declared"}`
so the gap is visible at the point somebody would look for it.

That is a declared absence, not evidence this tool failed to obtain, so it does
not make the run `incomplete` — the export was read in full. It is a `warning`,
so it is visible without failing a build.

Staleness is a different question and this tool cannot answer it: it reads no
clock, and `observedAt` is an opaque label copied verbatim. A tool that
invented "now" would also make two runs of the same exports disagree.

## Why there is no SQL

A query declares the models it reads. Inferring them from query text needs a
dialect-aware parser, and a parser that half-understands a dialect produces the
same class of wrong-but-plausible edge as reading an unsupported export. Where a
query genuinely cannot name a source, the export says so in `unresolvedSources`
and the tool reports that, which is the honest form of the same information.

## Why the run is bounded and not only the documents

Every other limit this tool declares bounds one document: bytes, tiles,
queries, references per query. Their *product* is not bounded by any of them —
200 files x 500 tiles x 100 references is ten million lineage edges — and the
map is held in full before it is serialised, so ten million edges is a process
that dies rather than a report that says no. Measured before the fix, at exactly
the documented maximum: `FATAL ERROR: Ineffective mark-compacts near heap
limit`, exit 134, empty stdout, 4.45 GB peak RSS, 460 s. The module comment in
`limits.mjs` had described that outcome as the thing these bounds prevent.

`maxTileModelEdges` bounds the work. It is counted from the compiled document
*before* any of that document's edges are built, because a count taken
afterwards is the same crash one allocation later, and the run stops with
`edge-limit-reached` naming every export that was not mapped. The ten-million
edge tree now finishes in 8.3 s at 514 MB, exit 2, with a report saying which
198 exports it did not read; a tree at the new documented maximum — 100000
edges with every identifier and title at its limit — exits 0 in 5.4 s at
1.21 GB, writing a 189 MB map.

The default is a judgement, not a measurement: 100000 edges is far more than a
real BI estate reaches (200 dashboards of 50 tiles reading 5 models each is
50000) and it is what one machine can hold without thinking about it. A caller
who knows their machine raises the flag; the failure it prevents is the one
where nobody was asked.

## Why `--out` is not confined

A confinement root for the output would mean writing the map inside the export
tree it describes, where the next run would list it as a dashboard file. `--out`
is an ordinary path: the destination is checked for a symbolic link and for
sharing an inode with anything the run resolved — including files it only listed
— and a symbolically linked parent directory is followed exactly as `cp` follows
one. Declared *input* paths are confined to the real root, and that is a
different guarantee, made in `documents.mjs`.
