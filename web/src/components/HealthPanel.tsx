import { IconHeartbeat } from "@tabler/icons-react";
import { Button, Link, StatusDot, cn, useToast } from "obp-ui";
import { type ReactNode, useState } from "react";
import { useMachineAction } from "~/api/machineQueries";
import {
    type Area,
    type AreaCheck,
    type Problem,
    type ProblemKind,
    type ProblemSeverity,
    useHealthChecks,
    useProblems,
} from "~/api/problemQueries";
import { PoolLink } from "~/components/PoolLink";
import { RemoveMachineDialog } from "~/components/RemoveMachine";
import { ErrorLine, PanelSection, errorMessage } from "~/components/Section";
import { When } from "~/components/When";
import { count } from "~/lib/format";

const COLLAPSED_LINES = 4;

type Tone = NonNullable<AreaCheck["tone"]>;

const TONE_TEXT: Record<Tone, string> = {
    success: "",
    warning: "text-warning",
    destructive: "text-destructive",
};
const LINE = "flex h-10 min-w-0 items-center gap-3 px-4";

const TONES: Record<ProblemSeverity, "destructive" | "warning" | "info"> = {
    critical: "destructive",
    warning: "warning",
    info: "info",
};

const SEVERITY_WORDS: Record<ProblemSeverity, string> = {
    critical: "Critical",
    warning: "Warning",
    info: "Note",
};

const GROUPS: Record<ProblemKind, { many: (n: number) => string; href: string }> = {
    audit_chain_broken: { many: () => "Audit log integrity broken", href: "/settings/audit" },
    siem_behind: {
        many: () => "Audit events are not reaching the SIEM",
        href: "/settings/security#audit-integrity",
    },
    model_down: {
        many: (n) => `${count(n)} live models have no running replica`,
        href: "/models",
    },
    engine_failed: { many: (n) => `${count(n)} engines failed`, href: "/infrastructure/machines" },
    disk_low: { many: (n) => `${count(n)} disks nearly full`, href: "/infrastructure/storage" },
    version_mismatch: {
        many: (n) => `${count(n)} machines run other library versions than main`,
        href: "/infrastructure/machines",
    },
    training_failed: {
        many: (n) => `${count(n)} training runs failed`,
        href: "/training?status=failed",
    },
    machine_offline: {
        many: (n) => `${count(n)} machines offline`,
        href: "/infrastructure/machines?status=offline",
    },
};

const AREA_OF: Record<ProblemKind, Area> = {
    audit_chain_broken: "audit",
    siem_behind: "audit",
    model_down: "serving",
    engine_failed: "serving",
    disk_low: "storage",
    version_mismatch: "machines",
    training_failed: "training",
    machine_offline: "machines",
};

type Line = { key: string; problems: Problem[] };

function grouped(problems: Problem[]): Line[] {
    const lines = new Map<ProblemKind, Problem[]>();
    for (const problem of problems) {
        lines.set(problem.kind, [...(lines.get(problem.kind) ?? []), problem]);
    }
    return [...lines.entries()].map(([kind, members]) => ({
        key: members.length === 1 ? members[0].id : kind,
        problems: members,
    }));
}

function single(problems: Problem[]): Line[] {
    return problems.map((problem) => ({ key: problem.id, problems: [problem] }));
}

function worst(problems: Problem[]): ProblemSeverity {
    if (problems.some((problem) => problem.severity === "critical")) {
        return "critical";
    }
    return problems.some((problem) => problem.severity === "warning") ? "warning" : "info";
}

function RemoveAction({ pool, host }: { pool: string; host: string }) {
    const action = useMachineAction(pool, host);
    const toast = useToast();
    const remove = () =>
        action.mutateAsync("remove").then(
            () => toast({ title: `${host} removed from its pool`, tone: "success" }),
            (error) =>
                toast({
                    title: `${host} was not removed`,
                    description: errorMessage(error),
                    tone: "destructive",
                }),
        );
    return (
        <RemoveMachineDialog
            pool={pool}
            host={host}
            trigger={
                <Button variant="outline" size="sm">
                    Remove
                </Button>
            }
            onConfirm={remove}
        />
    );
}

function Meta({ children }: { children: ReactNode }) {
    return (
        <span className="hidden shrink-0 text-sm text-muted-foreground @md:inline">{children}</span>
    );
}

function Severity({ severity }: { severity: ProblemSeverity }) {
    return (
        <>
            <StatusDot tone={TONES[severity]} className="shrink-0" />
            <span className="sr-only">{`${SEVERITY_WORDS[severity]}: `}</span>
        </>
    );
}

function ProblemParts({ line, more = 0 }: { line: Line; more?: number }) {
    const [first] = line.problems;
    const many = line.problems.length > 1;
    const group = GROUPS[first.kind];
    const text = many
        ? `${group.many(line.problems.length)}: ${line.problems.map((problem) => problem.subject).join(", ")}`
        : first.text;
    return (
        <>
            <span className="min-w-0 flex-1 truncate" title={text}>
                {text}
            </span>
            {more > 0 && (
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{`+${count(more)} more`}</span>
            )}
            {!many && first.pool && (
                <Meta>
                    <PoolLink name={first.pool} />
                </Meta>
            )}
            {!many && first.since && (
                <Meta>
                    <When value={first.since} />
                </Meta>
            )}
            {!many &&
                (first.actions ?? []).map((action) => (
                    <RemoveAction
                        key={`${action.kind}-${action.pool}-${action.host}`}
                        pool={action.pool}
                        host={action.host}
                    />
                ))}
            <Link
                href={many ? group.href : first.href}
                className="shrink-0 text-primary hover:underline"
            >
                Open
            </Link>
        </>
    );
}

function ProblemLine({ line }: { line: Line }) {
    return (
        <li className={LINE}>
            <Severity severity={worst(line.problems)} />
            <ProblemParts line={line} />
        </li>
    );
}

function AreaLine({ check, problems }: { check: AreaCheck; problems: Problem[] }) {
    const [first] = grouped(problems);
    if (first) {
        return (
            <li className={cn(LINE, "h-auto min-h-10 flex-1")}>
                <Severity severity={worst(first.problems)} />
                <span className="w-20 shrink-0 text-muted-foreground">{check.label}</span>
                <ProblemParts line={first} more={problems.length - first.problems.length} />
            </li>
        );
    }
    const tone: Tone = check.tone ?? "success";
    return (
        <li className="flex min-h-10 min-w-0 flex-1 items-center gap-3 px-4 py-2.5">
            <StatusDot tone={tone} className="shrink-0" />
            <span className="w-20 shrink-0 text-muted-foreground">{check.label}</span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("truncate", TONE_TEXT[tone])} title={check.text}>
                    {check.text}
                </span>
                {check.others && (
                    <span className="truncate text-sm text-muted-foreground">{check.others}</span>
                )}
            </span>
            {check.href && (
                <Link href={check.href} className="shrink-0 text-primary hover:underline">
                    Open
                </Link>
            )}
        </li>
    );
}

function Lines({
    problems,
    expanded,
    loading,
    error,
}: {
    problems: Problem[] | undefined;
    expanded: boolean;
    loading: boolean;
    error: unknown;
}) {
    if (error) {
        return (
            <div className={LINE}>
                <ErrorLine error={error} />
            </div>
        );
    }
    if (!problems) {
        return <p className={`${LINE} text-muted-foreground`}>{loading ? "Checking…" : ""}</p>;
    }
    const lines = expanded ? single(problems) : grouped(problems).slice(0, COLLAPSED_LINES);
    return (
        <ul className="@container flex flex-col divide-y">
            {lines.map((line) => (
                <ProblemLine key={line.key} line={line} />
            ))}
        </ul>
    );
}

function ShowAll({
    total,
    more,
    expanded,
    onToggle,
}: {
    total: number;
    more: boolean;
    expanded: boolean;
    onToggle: () => void;
}) {
    return (
        <span className="flex h-8 items-center">
            {more && (
                <Button variant="ghost" onClick={onToggle}>
                    {expanded ? "Show less" : `Show all (${count(total)})`}
                </Button>
            )}
        </span>
    );
}

function HealthyLine({ loading }: { loading: boolean }) {
    return (
        <p className="flex h-8 items-center gap-2">
            {loading ? (
                <span className="text-muted-foreground">Checking…</span>
            ) : (
                <>
                    <StatusDot tone="success" className="shrink-0" />
                    All healthy
                </>
            )}
        </p>
    );
}

function inArea(problems: Problem[], area: Area): Problem[] {
    return problems.filter((problem) => AREA_OF[problem.kind] === area);
}

function areaLines(areas: AreaCheck[], problems: Problem[]): number {
    return areas.reduce((shown, check) => {
        const [first] = grouped(inArea(problems, check.area));
        return shown + (first?.problems.length ?? 0);
    }, 0);
}

export function HealthPanel() {
    const found = useHealthChecks();
    const [expanded, setExpanded] = useState(false);
    const areas = found.data?.areas ?? [];
    const problems = found.data?.problems ?? [];
    const more = problems.length > areaLines(areas, problems);
    const open = expanded && more;
    return (
        <PanelSection
            flush
            icon={IconHeartbeat}
            title="Health"
            description={
                found.data ? (
                    <>
                        {"Checked "}
                        <When value={found.data.checked_at} />
                    </>
                ) : undefined
            }
            actions={
                <ShowAll
                    total={problems.length}
                    more={more}
                    expanded={open}
                    onToggle={() => setExpanded((value) => !value)}
                />
            }
        >
            {found.error || !found.data || open ? (
                <Lines
                    problems={found.data?.problems}
                    expanded={open}
                    loading={found.isLoading}
                    error={found.error}
                />
            ) : (
                <ul className="@container flex flex-1 flex-col divide-y">
                    {areas.map((check) => (
                        <AreaLine
                            key={check.area}
                            check={check}
                            problems={inArea(problems, check.area)}
                        />
                    ))}
                </ul>
            )}
        </PanelSection>
    );
}

export function ModelHealth({ model }: { model: string }) {
    const found = useProblems({ scope: "model", model });
    const [expanded, setExpanded] = useState(false);
    const problems = found.data;
    if (!found.error && (problems?.length ?? 0) === 0) {
        return <HealthyLine loading={!problems} />;
    }
    const shown = problems ? Math.min(grouped(problems).length, COLLAPSED_LINES) : 0;
    const more = (problems?.length ?? 0) > shown;
    return (
        <PanelSection
            flush
            icon={IconHeartbeat}
            title="Health"
            actions={
                <ShowAll
                    total={problems?.length ?? 0}
                    more={more}
                    expanded={expanded}
                    onToggle={() => setExpanded((open) => !open)}
                />
            }
        >
            <Lines
                problems={problems}
                expanded={expanded && more}
                loading={found.isLoading}
                error={found.error}
            />
        </PanelSection>
    );
}
