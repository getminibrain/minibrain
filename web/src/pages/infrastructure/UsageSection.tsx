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
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Link, cn } from "obp-ui";
import type { ReactNode } from "react";
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
        label: "Adapters and exports",
        icon: IconPuzzle,
        empty: "No model has a trained version yet.",
        name: (item) => <TextLink href={modelPageHref(item.key, "versions")}>{item.name}</TextLink>,
        detail: (item) =>
            item.exports
                ? `${plural(item.count ?? 0, "version")} · ${plural(item.exports, "merged export")}`
                : plural(item.count ?? 0, "version"),
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

const ITEM_ROW = "flex min-w-0 items-baseline gap-3 py-1.5 pr-4 pl-16";

function GroupItems({ view, group }: { view: KindView; group: UsageGroup }) {
    const items = group.items;
    const rest = group.count - items.length;
    const restBytes = group.size_bytes - items.reduce((sum, item) => sum + item.size_bytes, 0);
    return (
        <div className="flex flex-col pb-2">
            {items.length === 0 && (
                <p className={cn(ITEM_ROW, "text-muted-foreground")}>{view.empty}</p>
            )}
            {items.map((item) => (
                <div key={item.key} className={ITEM_ROW}>
                    <span className="max-w-[45%] shrink-0 truncate">{view.name(item)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {view.detail(item)}
                    </span>
                    <span className="shrink-0 tabular-nums">{bytes(item.size_bytes)}</span>
                </div>
            ))}
            {rest > 0 && (
                <p className={cn(ITEM_ROW, "text-sm text-muted-foreground tabular-nums")}>
                    <span className="flex-1">{`${count(rest)} smaller`}</span>
                    <span className="shrink-0">{bytes(restBytes)}</span>
                </p>
            )}
        </div>
    );
}

function GroupRow({ kind, group }: { kind: UsageKind; group: UsageGroup | undefined }) {
    const view = KINDS[kind];
    const Icon = view.icon;
    return (
        <Collapsible>
            <CollapsibleTrigger
                disabled={!group}
                className="flex w-full gap-2 rounded-none px-4 py-2 font-normal hover:bg-secondary focus-visible:ring-inset focus-visible:ring-offset-0"
            >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span>{view.label}</span>
                {group && group.count > 0 && (
                    <span className="text-sm text-muted-foreground tabular-nums">
                        {count(group.count)}
                    </span>
                )}
                <span className="ml-auto font-medium tabular-nums">
                    {group ? bytes(group.size_bytes) : "…"}
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
                {group && <GroupItems view={view} group={group} />}
            </CollapsibleContent>
        </Collapsible>
    );
}

export function UsageSection({ info }: { info: InfrastructureInfo | undefined }) {
    const groups = new Map((info?.usage ?? []).map((group) => [group.kind, group]));
    return (
        <PanelSection
            flush
            icon={IconChartPie}
            title="What's using it"
            description="minibrain's files and records by what they belong to. Open a group for its biggest items."
        >
            <div className="flex flex-col divide-y">
                {ORDER.map((kind) => (
                    <GroupRow key={kind} kind={kind} group={info ? groups.get(kind) : undefined} />
                ))}
            </div>
        </PanelSection>
    );
}
