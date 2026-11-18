import { IconAlertTriangle } from "@tabler/icons-react";
import { Button, Link, StatusDot, useToast } from "obp-ui";
import { type ReactNode, useState } from "react";
import { useMachineAction } from "~/api/machineQueries";
import {
    type Problem,
    type ProblemFilter,
    type ProblemKind,
    type ProblemSeverity,
    useProblems,
} from "~/api/problemQueries";
import { PoolLink } from "~/components/PoolLink";
import { RemoveMachineDialog } from "~/components/RemoveMachine";
import { ErrorLine, PanelSection, errorMessage } from "~/components/Section";
import { When } from "~/components/When";
import { count } from "~/lib/format";

const COLLAPSED_LINES = 4;
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

function ProblemLine({ line }: { line: Line }) {
    const [first] = line.problems;
    const many = line.problems.length > 1;
    const severity = worst(line.problems);
    const group = GROUPS[first.kind];
    const text = many
        ? `${group.many(line.problems.length)}: ${line.problems.map((problem) => problem.subject).join(", ")}`
        : first.text;
    return (
        <li className={LINE}>
            <StatusDot tone={TONES[severity]} className="shrink-0" />
            <span className="sr-only">{`${SEVERITY_WORDS[severity]}: `}</span>
            <span className="min-w-0 flex-1 truncate" title={text}>
                {text}
            </span>
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
    if (problems.length === 0) {
        return (
            <p className={LINE}>
                <StatusDot tone="success" className="shrink-0" />
                All healthy
            </p>
        );
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

export function NeedsAttention({
    scope,
    model,
    title = "Needs attention",
    description,
    compact = false,
}: ProblemFilter & { title?: string; description?: string; compact?: boolean }) {
    const found = useProblems({ scope, model });
    const [expanded, setExpanded] = useState(false);
    const problems = found.data;
    if (compact && !found.error && (problems?.length ?? 0) === 0) {
        return <HealthyLine loading={!problems} />;
    }
    const shown = problems ? Math.min(grouped(problems).length, COLLAPSED_LINES) : 0;
    const more = (problems?.length ?? 0) > shown;
    const toggle = (
        <span className="flex h-8 items-center">
            {more && (
                <Button variant="ghost" onClick={() => setExpanded((open) => !open)}>
                    {expanded ? "Show less" : `Show all (${count(problems?.length ?? 0)})`}
                </Button>
            )}
        </span>
    );
    return (
        <PanelSection
            flush
            icon={IconAlertTriangle}
            title={title}
            description={description}
            actions={toggle}
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
