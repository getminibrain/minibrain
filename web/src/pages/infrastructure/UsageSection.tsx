import {
    IconBox,
    IconChartPie,
    IconDatabase,
    IconFileText,
    IconPuzzle,
    IconTable,
    IconUpload,
    type TablerIcon,
} from "@tabler/icons-react";
import { Link, Table, TableBody, TableCell, TableRow } from "obp-ui";
import { Fragment, type ReactNode } from "react";
import type { components } from "~/api/schema";
import { PanelSection } from "~/components/Section";
import { count } from "~/lib/format";
import { JOBS_PATH, modelPageHref } from "~/lib/modelLinks";
import { bytes, relativeTime } from "~/lib/time";
import { datasetHref } from "~/pages/models/list/cells";
import { type InfrastructureInfo, plural } from "./parts";

type UsageGroup = components["schemas"]["UsageGroup"];
type UsageItem = components["schemas"]["UsageItem"];
type UsageKind = UsageGroup["kind"];

const SHOWN_USERS = 3;

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <Link href={href} className="text-primary hover:underline">
            {children}
        </Link>
    );
}

export function sourceHref(key: string): string {
    return `/data?item=${encodeURIComponent(`source:${key}`)}`;
}

function BaseUse({ item }: { item: UsageItem }) {
    const users = item.used_by ?? [];
    const roles = [item.checks && "judges or checks safety", item.deployed && "deployed"].filter(
        Boolean,
    );
    if (users.length === 0) {
        return (
            <>
                {roles.length > 0
                    ? `No model built on it · ${roles.join(" · ")}`
                    : "No model uses it"}
            </>
        );
    }
    const shown = users.slice(0, SHOWN_USERS);
    const more = users.length - shown.length;
    return (
        <span className="flex min-w-0 flex-wrap gap-x-1">
            <span>Used by</span>
            {shown.map((user, index) => (
                <span key={user.key}>
                    <TextLink href={modelPageHref(user.key)}>{user.name}</TextLink>
                    {index < shown.length - 1 || more > 0 ? "," : ""}
                </span>
            ))}
            {more > 0 && <span>{`${count(more)} more`}</span>}
            {roles.length > 0 && <span>{`· ${roles.join(" · ")}`}</span>}
        </span>
    );
}

type KindView = {
    label: string;
    icon: TablerIcon;
    empty: string;
    name: (item: UsageItem) => ReactNode;
    detail: (item: UsageItem) => ReactNode;
};

const KINDS: Record<UsageKind, KindView> = {
    bases: {
        label: "Base models",
        icon: IconBox,
        empty: "No base model files stored.",
        name: (item) => <TextLink href={modelPageHref(item.key)}>{item.name}</TextLink>,
        detail: (item) => <BaseUse item={item} />,
    },
    adapters: {
        label: "Adapters",
        icon: IconPuzzle,
        empty: "No model has a trained version yet.",
        name: (item) => <TextLink href={modelPageHref(item.key, "versions")}>{item.name}</TextLink>,
        detail: (item) => plural(item.count ?? 0, "version"),
    },
    datasets: {
        label: "Dataset versions",
        icon: IconTable,
        empty: "No dataset version saved yet.",
        name: (item) => <TextLink href={datasetHref(item.key)}>{item.name}</TextLink>,
        detail: (item) => plural(item.count ?? 0, "version"),
    },
    uploads: {
        label: "Uploads",
        icon: IconUpload,
        empty: "No file uploaded yet.",
        name: (item) => <TextLink href={sourceHref(item.key)}>{item.name}</TextLink>,
        detail: () => "Source file",
    },
    jobs: {
        label: "Job logs and checkpoints",
        icon: IconFileText,
        empty: "No job has left a log or checkpoint.",
        name: (item) => (
            <TextLink
                href={`${JOBS_PATH}/${item.key}`}
            >{`Job #${item.key} · ${item.name}`}</TextLink>
        ),
        detail: (item) =>
            item.finished_at ? `Finished ${relativeTime(item.finished_at)}` : "Not finished",
    },
    database: {
        label: "Database",
        icon: IconDatabase,
        empty: "Postgres keeps the database; its size shows on that server.",
        name: (item) => <span className="font-mono">{item.name}</span>,
        detail: () => "Models, versions, jobs, request logs and the audit log",
    },
};

const ORDER: UsageKind[] = ["bases", "adapters", "datasets", "uploads", "jobs", "database"];

function GroupRows({ kind, group }: { kind: UsageKind; group: UsageGroup | undefined }) {
    const view = KINDS[kind];
    const Icon = view.icon;
    const items = group?.items ?? [];
    const rest = (group?.count ?? 0) - items.length;
    const restBytes =
        (group?.size_bytes ?? 0) - items.reduce((sum, item) => sum + item.size_bytes, 0);
    return (
        <>
            <TableRow className="bg-muted hover:bg-muted">
                <TableCell colSpan={2} className="font-medium">
                    <span className="flex items-center gap-2">
                        <Icon
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground"
                        />
                        {view.label}
                        {group && group.count > 0 && (
                            <span className="text-sm font-normal text-muted-foreground tabular-nums">
                                {count(group.count)}
                            </span>
                        )}
                    </span>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                    {group ? bytes(group.size_bytes) : "…"}
                </TableCell>
            </TableRow>
            {group && items.length === 0 && (
                <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="pl-9 text-muted-foreground">
                        {view.empty}
                    </TableCell>
                </TableRow>
            )}
            {items.map((item) => (
                <TableRow key={item.key} className="hover:bg-transparent">
                    <TableCell className="truncate pl-9">{view.name(item)}</TableCell>
                    <TableCell className="truncate text-muted-foreground">
                        {view.detail(item)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                        {bytes(item.size_bytes)}
                    </TableCell>
                </TableRow>
            ))}
            {rest > 0 && (
                <TableRow className="hover:bg-transparent">
                    <TableCell
                        colSpan={2}
                        className="pl-9 text-sm text-muted-foreground tabular-nums"
                    >
                        {`${count(rest)} smaller`}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                        {bytes(restBytes)}
                    </TableCell>
                </TableRow>
            )}
        </>
    );
}

export function UsageSection({ info }: { info: InfrastructureInfo | undefined }) {
    const groups = new Map((info?.usage ?? []).map((group) => [group.kind, group]));
    return (
        <PanelSection
            flush
            icon={IconChartPie}
            title="What's using it"
            description="minibrain's files and records by what they belong to, biggest first."
        >
            <Table className="table-fixed">
                <colgroup>
                    <col className="w-[38%]" />
                    <col />
                    <col className="w-28" />
                </colgroup>
                <TableBody>
                    {ORDER.map((kind) => (
                        <Fragment key={kind}>
                            <GroupRows kind={kind} group={info ? groups.get(kind) : undefined} />
                        </Fragment>
                    ))}
                </TableBody>
            </Table>
        </PanelSection>
    );
}
