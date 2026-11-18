import { IconChevronRight } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
    Button,
    CheckboxSelect,
    DataGrid,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    InfoTip,
    Link,
    Switch,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn,
} from "obp-ui";
import { useMemo, useState } from "react";
import { type ModelVersionRow, type VersionInfo, api, unwrap } from "~/api/client";
import { useAllModels, useVersions } from "~/api/queries";
import { SectionError } from "~/components/ErrorState";
import { PageHeader } from "~/components/PageHeader";
import { modelOption } from "~/components/PublisherLogo";
import { ErrorLine, Page, Stat } from "~/components/Section";
import {
    VERSION_STATES,
    VersionState,
    versionState,
    versionStateLabel,
    versionStateRank,
} from "~/components/StatusBadge";
import {
    GraderScores,
    PresetResults,
    PromotionDecision,
    ScoredBy,
} from "~/components/models/VersionResults";
import { useCan } from "~/lib/access";
import { costSortValue, costText, deviceTime, headline, measuredOn, priced } from "~/lib/cost";
import { count, milliseconds, percent, pointsSize } from "~/lib/format";
import { checkSentence } from "~/lib/judging";
import { listHref, splitList, useListSearch } from "~/lib/listSearch";
import { metricName, metricOf } from "~/lib/metrics";
import { modelCardHref, modelPageHref } from "~/lib/modelLinks";
import { relativeTime } from "~/lib/time";
import { DataVersus } from "./data/versionData";
import {
    type Group,
    type Line,
    byPriority,
    change,
    commonMetric,
    groupsOf,
    lineKey,
    linesOf,
    mixedMetrics,
    moved,
    scoredTime,
} from "./evaluations/lines";
import { Updated } from "./models/MyModels";

const PATH = "/evaluations";
const KEYS = ["model", "status", "version", "all"] as const;
const HIDDEN = ["kind", "created", "p50", "p95", "cost"];

const KIND_NAMES: Record<string, string> = { lora: "Trained", prompt: "Prompt-only" };

type Target = { slug: string; number: number };

type GridRow = { id: string; line: Line; group: Group | null; child: boolean };

type Value = string | number;

function readTarget(value: string | undefined): Target | null {
    const at = value?.lastIndexOf("@") ?? -1;
    const number = Number(value?.slice(at + 1));
    return value && at > 0 && Number.isInteger(number)
        ? { slug: value.slice(0, at), number }
        : null;
}

function Change({ line }: { line: Line }) {
    const delta = change(line);
    const direction = moved(line);
    if (delta === null || direction === null) {
        return <span className="text-muted-foreground">–</span>;
    }
    const points = pointsSize(delta);
    if (direction === "same") {
        return <span className="tabular-nums text-muted-foreground">Same</span>;
    }
    return direction === "better" ? (
        <span className="tabular-nums text-success">{`+${points} pts`}</span>
    ) : (
        <span className="tabular-nums text-destructive">{`−${points} pts`}</span>
    );
}

const COST_INFO =
    "Measured GPU time per 1M prompt and output tokens on held-out requests, times the pool's price per hour from Settings. Without a price, the GPU time itself.";

function baselineOf(line: Line): ModelVersionRow | undefined {
    const earlier = (line.model.versions ?? []).filter(
        (version) =>
            version.number < line.version.number &&
            version.status === "ready" &&
            version.score !== null,
    );
    const prompts = earlier
        .filter((version) => version.kind === "prompt")
        .sort((a, b) => a.number - b.number);
    return earlier.find((version) => version.number === 0) ?? prompts[0];
}

function lineHeadline(line: Line): string | null {
    const base = baselineOf(line);
    return base ? headline(base, line.version) : null;
}

function Score({ version, metric }: { version: ModelVersionRow; metric: string | null }) {
    const other = version.score !== null && version.metric !== metric;
    return (
        <span className="tabular-nums">
            {percent(version.score)}
            {other && (
                <span className="text-muted-foreground">{` ${metricName(version.metric).toLowerCase()}`}</span>
            )}
        </span>
    );
}

function LiveCell({ row, metric }: { row: GridRow; metric: string | null }) {
    if (row.child) {
        return null;
    }
    const live = row.line.live;
    if (!live) {
        return <span className="text-muted-foreground">–</span>;
    }
    return (
        <span className="flex items-baseline gap-2 whitespace-nowrap tabular-nums">
            <span className="text-muted-foreground">{`v${live.number}`}</span>
            <Score version={live} metric={metric} />
        </span>
    );
}

function ModelCell({ row, open, href }: { row: GridRow; open: boolean; href: string }) {
    if (row.child) {
        return null;
    }
    if (!row.group) {
        return (
            <Link href={href} className="block max-w-48 truncate font-semibold text-foreground">
                {row.line.model.name}
            </Link>
        );
    }
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <IconChevronRight
                aria-hidden="true"
                className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                    open && "rotate-90",
                )}
            />
            <span className="max-w-44 truncate font-semibold text-foreground">
                {row.line.model.name}
            </span>
        </span>
    );
}

function scoreHeader(metric: string | null, mixed: boolean) {
    const info = mixed
        ? `Each version's main metric on held-out rows it never trained on. Versions scored by another metric name it next to the score.`
        : "Each version's main metric on held-out rows it never trained on.";
    return { header: metric ? metricName(metric) : "Held-out score", info };
}

const SORTS: Record<string, (row: GridRow) => Value> = {
    model: (row) => row.line.model.name.toLowerCase(),
    live: (row) => row.line.live?.score ?? -1,
    version: (row) => row.line.version.number,
    kind: (row) => KIND_NAMES[row.line.version.kind] ?? row.line.version.kind,
    score: (row) => row.line.version.score ?? -1,
    rule: (row) => (row.line.version.promotion ? Number(row.line.version.promotion.passed) : -1),
    change: (row) => change(row.line) ?? Number.NEGATIVE_INFINITY,
    p50: (row) => row.line.version.latency_p50_ms ?? Number.POSITIVE_INFINITY,
    p95: (row) => row.line.version.latency_p95_ms ?? Number.POSITIVE_INFINITY,
    cost: (row) => costSortValue(row.line.version.cost),
    scored: (row) => scoredTime(row.line.version),
    created: (row) => Date.parse(row.line.version.created_at),
    status: (row) => versionStateRank(row.line.version),
};

function compareValues(left: Value, right: Value): number {
    if (typeof left === "number" && typeof right === "number") {
        return Math.sign(left - right) || 0;
    }
    return String(left).localeCompare(String(right));
}

function sortGroups(groups: Group[], sorting: SortingState): Group[] {
    const rule = sorting[0];
    const value = rule ? SORTS[rule.id] : undefined;
    if (!rule || !value) {
        return groups;
    }
    const of = (group: Group) => value({ id: "", line: group.summary, group, child: false });
    const sign = rule.desc ? -1 : 1;
    return [...groups].sort(
        (left, right) => sign * compareValues(of(left), of(right)) || byPriority(left, right),
    );
}

function gridColumns({
    grouped,
    metric,
    mixed,
    expanded,
    href,
}: {
    grouped: boolean;
    metric: string | null;
    mixed: boolean;
    expanded: Set<string>;
    href: (line: Line) => string;
}): ColumnDef<GridRow, unknown>[] {
    const score = scoreHeader(metric, mixed);
    const sorted = (id: string) => ({ id, accessorFn: SORTS[id] });
    return [
        {
            ...sorted("model"),
            header: "Model",
            enableHiding: false,
            cell: ({ row }) => (
                <ModelCell
                    row={row.original}
                    open={expanded.has(row.original.line.model.key)}
                    href={href(row.original.line)}
                />
            ),
        },
        ...(grouped
            ? [
                  {
                      ...sorted("live"),
                      header: "Live",
                      meta: { info: "The version serving requests now, and its score." },
                      cell: ({ row }: { row: { original: GridRow } }) => (
                          <LiveCell row={row.original} metric={metric} />
                      ),
                  } satisfies ColumnDef<GridRow, unknown>,
              ]
            : []),
        {
            ...sorted("version"),
            header: "Version",
            meta: grouped ? { info: "A model's row shows its latest scored version." } : undefined,
            cell: ({ row }) => (
                <Link
                    href={href(row.original.line)}
                    className={cn(
                        "tabular-nums text-foreground hover:underline",
                        row.original.child && "pl-2",
                    )}
                >{`v${row.original.line.version.number}`}</Link>
            ),
        },
        {
            ...sorted("kind"),
            header: "Kind",
        },
        {
            ...sorted("score"),
            header: score.header,
            meta: { info: score.info },
            cell: ({ row }) => <Score version={row.original.line.version} metric={metric} />,
        },
        {
            ...sorted("change"),
            header: "vs live",
            cell: ({ row }) => <Change line={row.original.line} />,
        },
        {
            ...sorted("rule"),
            header: "Deploy rule",
            cell: ({ row }) => <RuleCell version={row.original.line.version} />,
        },
        {
            ...sorted("p50"),
            header: "p50",
            cell: ({ row }) => (
                <span className="tabular-nums">
                    {milliseconds(row.original.line.version.latency_p50_ms)}
                </span>
            ),
        },
        {
            ...sorted("p95"),
            header: "p95",
            cell: ({ row }) => (
                <span className="tabular-nums">
                    {milliseconds(row.original.line.version.latency_p95_ms)}
                </span>
            ),
        },
        {
            ...sorted("cost"),
            header: "Cost / 1M tokens",
            meta: { info: COST_INFO },
            cell: ({ row }) => (
                <span className="tabular-nums">{costText(row.original.line.version.cost)}</span>
            ),
        },
        {
            ...sorted("scored"),
            header: "Scored",
            cell: ({ row }) => {
                const at = row.original.line.version.scored_at;
                return at ? (
                    <Updated value={at} />
                ) : (
                    <span className="text-muted-foreground">–</span>
                );
            },
        },
        {
            ...sorted("created"),
            header: "Created",
            cell: ({ row }) => <Updated value={row.original.line.version.created_at} />,
        },
        {
            ...sorted("status"),
            header: "Status",
            cell: ({ row }) => <VersionState version={row.original.line.version} />,
        },
    ];
}

function RuleCell({ version }: { version: ModelVersionRow }) {
    if (!version.promotion) {
        return <span className="text-muted-foreground">–</span>;
    }
    return version.promotion.passed ? (
        <span className="text-success">Passes</span>
    ) : (
        <span className="text-warning">Does not pass</span>
    );
}

function deployable(version: ModelVersionRow): boolean {
    return (
        version.status === "ready" &&
        !version.base_refusal &&
        !version.live &&
        (version.was_live || Boolean(version.promotion?.passed))
    );
}

function blockedReason(version: ModelVersionRow): string | null {
    if (version.status !== "ready" || version.live || deployable(version)) {
        return null;
    }
    if (version.base_refusal) {
        return version.base_refusal;
    }
    const failed = (version.promotion?.checks ?? []).filter((check) => !check.passed);
    return failed.map(checkSentence).join(" ") || "It doesn't meet the deploy rule.";
}

export function DeployButton({
    version,
    size,
    pending,
    onDeploy,
}: {
    version: ModelVersionRow;
    size?: "xs";
    pending: boolean;
    onDeploy: () => void;
}) {
    const reason = blockedReason(version);
    if (reason === null) {
        return deployable(version) ? (
            <Button
                variant={size ? "outline" : "default"}
                size={size}
                disabled={pending}
                onClick={onDeploy}
            >
                {`Deploy v${version.number}`}
            </Button>
        ) : null;
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="inline-flex">
                    <Button variant="outline" size={size} disabled>
                        {`Deploy v${version.number}`}
                    </Button>
                </span>
            </TooltipTrigger>
            <TooltipContent>
                {version.base_refusal ?? `It can't go live yet. ${reason}`}
            </TooltipContent>
        </Tooltip>
    );
}

export function usePromote() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (target: Target) =>
            unwrap(
                api.POST("/api/models/{name}/versions/{number}/promote", {
                    params: { path: { name: target.slug, number: target.number } },
                }),
            ),
        onSuccess: () => client.invalidateQueries(),
    });
}

type Mistake = VersionInfo["mistakes"][number];

const MISTAKE_COLUMNS: ColumnDef<Mistake, unknown>[] = [
    {
        header: "Input",
        accessorKey: "input",
        enableSorting: false,
        cell: (info) => (
            <span className="line-clamp-2 min-w-56 whitespace-normal">
                {String(info.getValue())}
            </span>
        ),
    },
    {
        header: "Expected",
        accessorKey: "gold",
        cell: (info) => <span className="font-mono">{String(info.getValue())}</span>,
    },
    {
        header: "Got",
        accessorKey: "output",
        cell: (info) => (
            <span className="font-mono text-destructive">{String(info.getValue())}</span>
        ),
    },
];

function VersionDetail({ line, onDone }: { line: Line; onDone: () => void }) {
    const versions = useVersions(line.model.key);
    const promote = usePromote();
    const can = useCan();
    const info = versions.data?.find((item) => item.number === line.version.number);
    const { model, version } = line;
    const kind = KIND_NAMES[version.kind] ?? version.kind;
    const summary = lineHeadline(line);
    const cost = info?.cost ?? version.cost;
    return (
        <>
            <DialogHeader>
                <DialogTitle>{`${model.name} v${version.number}`}</DialogTitle>
                <DialogDescription>{`${kind} · created ${relativeTime(version.created_at)}`}</DialogDescription>
            </DialogHeader>
            {summary && <p className="text-base font-semibold tabular-nums">{summary}</p>}
            <div className="flex flex-wrap gap-x-8 gap-y-4">
                <Stat label="Status" value={<VersionState version={version} />} />
                <Stat
                    label={`Held-out ${metricName(info?.main_metric).toLowerCase()}`}
                    value={percent(info?.score)}
                />
                <Stat label="vs live" value={<Change line={line} />} />
                <Stat
                    label="Data vs live"
                    value={
                        <DataVersus
                            versions={versions.data}
                            number={version.number}
                            against={line.live?.number}
                        />
                    }
                />
                <Stat label="Test set" value={percent(metricOf(info?.golden, info?.main_metric))} />
                <Stat label="Breaks the contract" value={percent(info?.held_out?.invalid_rate)} />
                <Stat label="p50" value={milliseconds(info?.latency_p50_ms)} />
                <Stat label="p95" value={milliseconds(info?.latency_p95_ms)} />
                <Stat
                    label="GPU time / 1M tokens"
                    value={
                        <span className="inline-flex items-center gap-1">
                            {deviceTime(cost)}
                            <InfoTip label="How cost is measured">{COST_INFO}</InfoTip>
                        </span>
                    }
                />
                {priced(cost) && <Stat label="Cost / 1M tokens" value={costText(cost)} />}
                <Stat label="Prompt tokens" value={count(info?.prompt_tokens)} />
                <Stat label="Output tokens" value={count(cost?.completion_tokens)} />
            </div>
            {cost?.device_name && (
                <p className="text-sm text-muted-foreground">{measuredOn(cost)}</p>
            )}
            {info?.held_out && <GraderScores split={info.held_out} main={info.main_metric} />}
            {info && <ScoredBy version={info} />}
            {info?.promotion && <PromotionDecision decision={info.promotion} />}
            {info && <PresetResults slug={model.key} version={info} />}
            {info && info.view !== "free_text" && info.mistakes.length > 0 && (
                <div className="flex min-w-0 flex-col gap-2">
                    <div>
                        <h3 className="text-base font-semibold">Mistakes</h3>
                        <p className="text-sm text-muted-foreground">
                            Up to 20 held-out rows it got wrong.
                        </p>
                    </div>
                    <DataGrid columns={MISTAKE_COLUMNS} rows={info.mistakes} maxHeight="280px" />
                </div>
            )}
            <ErrorLine error={versions.error ?? promote.error} />
            <DialogFooter>
                <Button variant="outline" asChild>
                    <Link href={modelPageHref(model.key)}>Model details</Link>
                </Button>
                <Button variant="outline" asChild>
                    <Link href={modelCardHref(model.key, version.number)}>Model card</Link>
                </Button>
                {can.build && (
                    <DeployButton
                        version={version}
                        pending={promote.isPending}
                        onDeploy={() =>
                            promote.mutate(
                                { slug: model.key, number: version.number },
                                { onSuccess: onDone },
                            )
                        }
                    />
                )}
            </DialogFooter>
        </>
    );
}

function VersionDialog({
    target,
    line,
    loading,
    onClose,
}: {
    target: Target | null;
    line: Line | undefined;
    loading: boolean;
    onClose: () => void;
}) {
    return (
        <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-3xl sm:has-[[data-wide]]:max-w-5xl">
                {line ? (
                    <VersionDetail line={line} onDone={onClose} />
                ) : (
                    <DialogHeader>
                        <DialogTitle>
                            {target ? `${target.slug} v${target.number}` : ""}
                        </DialogTitle>
                        <DialogDescription>
                            {loading ? "Loading…" : "This version is not on this install."}
                        </DialogDescription>
                    </DialogHeader>
                )}
            </DialogContent>
        </Dialog>
    );
}

function rowLabelOf(row: GridRow, open: boolean): string {
    const { model, version, live } = row.line;
    const state = versionStateLabel(versionState(version));
    if (!row.group) {
        return `${model.name} v${version.number}, ${percent(version.score)} held-out, ${state}`;
    }
    const serving = live ? `live v${live.number} ${percent(live.score)}` : "nothing live";
    return `${model.name}, ${serving}, latest v${version.number} ${percent(version.score)}, ${open ? "expanded" : "collapsed"}`;
}

function gridRows(groups: Group[], expanded: Set<string>): GridRow[] {
    return groups.flatMap((group) => [
        { id: group.model.key, line: group.summary, group, child: false },
        ...(expanded.has(group.model.key)
            ? group.lines.map((line) => ({ id: lineKey(line), line, group: null, child: true }))
            : []),
    ]);
}

function Empty({
    filtering,
    grouped,
    onClear,
}: {
    filtering: boolean;
    grouped: boolean;
    onClear: () => void;
}) {
    if (filtering) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-muted-foreground">
                    {grouped
                        ? "No models match these filters."
                        : "No versions match these filters."}
                </p>
                <Button variant="outline" onClick={onClear}>
                    Clear filters
                </Button>
            </div>
        );
    }
    return (
        <p className="text-muted-foreground">
            No versions yet. Score or train one from{" "}
            <Link href="/training" className="text-primary hover:underline">
                Training
            </Link>
            .
        </p>
    );
}

export function EvaluationsPage() {
    const { search, update } = useListSearch(PATH, KEYS);
    const models = useAllModels();
    const promote = usePromote();
    const can = useCan();
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [sorting, setSorting] = useState<SortingState>([]);
    const grouped = search.all !== "1";
    const all = useMemo(() => linesOf(models.data ?? []), [models.data]);
    const chosenModels = splitList(search.model);
    const statuses = splitList(search.status);
    const visible = all.filter(
        (line) =>
            (chosenModels.length === 0 || chosenModels.includes(line.model.key)) &&
            (statuses.length === 0 || statuses.includes(versionState(line.version))),
    );
    const filtering = chosenModels.length + statuses.length > 0;
    const target = readTarget(search.version);
    const opened = target
        ? all.find(
              (line) => line.model.key === target.slug && line.version.number === target.number,
          )
        : undefined;
    const metric = commonMetric(visible);
    const mixed = mixedMetrics(visible);
    const columns = useMemo(
        () =>
            gridColumns({
                grouped,
                metric,
                mixed,
                expanded,
                href: (line) => listHref(PATH, { ...search, version: lineKey(line) }),
            }),
        [grouped, metric, mixed, expanded, search],
    );
    const rows: GridRow[] = grouped
        ? gridRows(sortGroups(groupsOf(visible), sorting), expanded)
        : visible.map((line) => ({ id: lineKey(line), line, group: null, child: false }));
    const toggle = (key: string) =>
        setExpanded((current) => {
            const next = new Set(current);
            if (!next.delete(key)) {
                next.add(key);
            }
            return next;
        });
    const modelOptions = (models.data ?? [])
        .filter((row) => row.kind === "custom")
        .map((row) =>
            modelOption({
                value: row.key,
                label: row.name,
                publisher: row.publisher,
                count: row.versions?.length ?? 0,
            }),
        );
    const statusOptions = VERSION_STATES.map((state) => ({
        value: state,
        label: versionStateLabel(state),
        count: all.filter((line) => versionState(line.version) === state).length,
    }));
    const clear = () => update({ model: "", status: "" });
    return (
        <Page wide>
            <PageHeader
                title="Evaluations"
                caption="Every model's live and latest scored version, scored by its graders on held-out rows. A version goes live only when it meets its model's deploy rule."
            />
            <div className="flex flex-wrap items-center gap-2">
                <CheckboxSelect
                    label="Model"
                    allLabel="All models"
                    noun="models"
                    options={modelOptions}
                    value={chosenModels}
                    onValueChange={(next) => update({ model: next.join(",") })}
                />
                <CheckboxSelect
                    label="Status"
                    allLabel="All statuses"
                    noun="statuses"
                    options={statusOptions}
                    value={statuses}
                    onValueChange={(next) => update({ status: next.join(",") })}
                />
                {filtering && (
                    <Button variant="ghost" onClick={clear}>
                        Clear filters
                    </Button>
                )}
                <label htmlFor="all-versions" className="ml-auto flex items-center gap-2">
                    <Switch
                        id="all-versions"
                        checked={!grouped}
                        onCheckedChange={(checked) => update({ all: checked ? "1" : "" })}
                    />
                    Show all versions
                </label>
            </div>
            <ErrorLine error={(models.data ? models.error : null) ?? promote.error} />
            <DataGrid
                key={grouped ? "models" : "versions"}
                columns={columns}
                rows={rows}
                loading={models.isLoading}
                getRowId={(row) => row.id}
                initialSort={grouped ? [] : [{ id: "scored", desc: true }]}
                sorting={grouped ? sorting : undefined}
                onSortingChange={grouped ? setSorting : undefined}
                storageKey="minibrain.evaluations.columns"
                hiddenColumns={HIDDEN}
                columnPicker
                onOpen={(row) =>
                    row.group ? toggle(row.line.model.key) : update({ version: lineKey(row.line) })
                }
                rowLabel={(row) => rowLabelOf(row, expanded.has(row.line.model.key))}
                rowActions={(row) =>
                    can.build ? (
                        <DeployButton
                            version={row.line.version}
                            size={row.child ? "xs" : undefined}
                            pending={promote.isPending}
                            onDeploy={() =>
                                promote.mutate({
                                    slug: row.line.model.key,
                                    number: row.line.version.number,
                                })
                            }
                        />
                    ) : null
                }
                empty={
                    models.error && !models.data ? (
                        <SectionError error={models.error} retry={models.refetch} />
                    ) : (
                        <Empty filtering={filtering} grouped={grouped} onClear={clear} />
                    )
                }
            />
            <VersionDialog
                target={target}
                line={opened}
                loading={models.isLoading}
                onClose={() => update({ version: "" })}
            />
        </Page>
    );
}
