import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "@tanstack/react-router";
import { TabNav } from "obp-ui";
import { type ReactNode, useEffect, useState } from "react";
import type { BaseModelDetail, ModelDetail, ModelRow, VersionInfo } from "~/api/client";
import { keys, useAllModels, useBaseModel, useModel, useVersions } from "~/api/queries";
import { NotFoundState, QueryError } from "~/components/ErrorState";
import { ModelHealth } from "~/components/HealthPanel";
import { PageCrumbs } from "~/components/PageCrumbs";
import { Page, PanelSections } from "~/components/Section";
import { ModelNotFound } from "~/components/models/ModelNotFound";
import { useCan } from "~/lib/access";
import { modelPageHref } from "~/lib/modelLinks";
import { modelsHref } from "~/lib/modelsSearch";
import { useScrollToHash } from "~/lib/scrollToHash";
import { deleteModel, rowId } from "~/lib/teardown";
import { DeleteModelsDialog } from "../DeleteModelsDialog";
import { ConfirmAction, type Confirmation, useModelsRefresh } from "../dialogs";
import type { Entry } from "../entries";
import { useHealthActions } from "../healthActions";
import { About, BaseAbout, BaseDetails, Details } from "./about";
import { ActivityPanel, ActivityTab } from "./activity";
import { CompareView } from "./compare";
import { ModelActions } from "./deploy";
import { EvaluationTab } from "./evaluation/EvaluationTab";
import { BaseFiles, CustomFiles, FilesSheet, adapterText, verifiedText } from "./files";
import { ModelHeader, baseNameOf } from "./header";
import { KeysTab } from "./keys";
import { liveOf } from "./makeLive";
import { MonitoringTab } from "./monitoring";
import { VersionsPanel } from "./overviewVersions";
import { HealthNotice, TeardownNotice } from "./parts";
import { SettingsTab } from "./settings";
import { TAB_LABELS, tabsFor, useModelTab } from "./tabs";
import { UsagePanel } from "./usage";
import { VersionView, useVersionNumber } from "./version";
import { VersionActivity, VersionsTab, inFlight } from "./versions";

type Lookup = {
    row: ModelRow | undefined;
    loading: boolean;
    error: unknown;
    retry: () => unknown;
    name: string;
};

function useRow(): Lookup {
    const { name = "" } = useParams({ strict: false }) as { name?: string };
    const models = useAllModels();
    return {
        row: models.data?.find((item) => item.key === name),
        loading: models.isLoading,
        error: models.error,
        retry: models.refetch,
        name,
    };
}

function Missing({ lookup }: { lookup: Lookup }) {
    const { row, loading, error, retry, name } = lookup;
    return (
        <Page wide>
            <PageCrumbs
                items={[
                    { label: "Models", href: modelsHref() },
                    { label: row?.name ?? name, href: row ? modelPageHref(row.key) : undefined },
                ]}
            />
            {loading ? (
                <p className="text-muted-foreground">Loading…</p>
            ) : error ? (
                <QueryError error={error} retry={retry} />
            ) : row ? (
                <NotFoundState
                    title="Base models have no versions"
                    primary={{ label: `Go to ${row.name}`, href: modelPageHref(row.key) }}
                >
                    {`${row.name} is a base model. Versions belong to the custom models built on it.`}
                </NotFoundState>
            ) : (
                <ModelNotFound name={name} />
            )}
        </Page>
    );
}

function OverviewLayout({ main, side }: { main: ReactNode; side?: ReactNode }) {
    if (!side) {
        return <PanelSections>{main}</PanelSections>;
    }
    return (
        <div className="@container">
            <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_24rem]">
                <div className="min-w-0">
                    <PanelSections>{main}</PanelSections>
                </div>
                <div className="min-w-0">
                    <PanelSections>{side}</PanelSections>
                </div>
            </div>
        </div>
    );
}

function Notices({ row }: { row: ModelRow }) {
    const can = useCan();
    const router = useRouter();
    const client = useQueryClient();
    const refresh = useModelsRefresh();
    const models = useAllModels();
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const [deleting, setDeleting] = useState<Entry[] | null>(null);
    const reload = async () => {
        await refresh();
        await client.invalidateQueries({ queryKey: keys.modelPage(row.key) });
        await client.invalidateQueries({ queryKey: keys.baseModel(row.key) });
    };
    const health = useHealthActions({
        refresh: reload,
        confirm: setConfirmation,
        remove: (target) => setDeleting([{ key: rowId(target), model: target, version: null }]),
    });
    const run = row.kind === "base" && can.admin ? health.run : undefined;
    return (
        <>
            <TeardownNotice
                row={row}
                canRetry={
                    can.admin ||
                    (can.build && (row.kind === "custom" || row.teardown?.kind === "undeploy"))
                }
                onRetried={reload}
                onReview={() => setDeleting([{ key: rowId(row), model: row, version: null }])}
            />
            <HealthNotice
                row={row}
                run={
                    row.kind === "custom"
                        ? (_, action) => {
                              if (action.kind === "open_base" && row.base_model) {
                                  router.history.push(modelPageHref(row.base_model));
                              }
                          }
                        : run
                }
                shown={(action) => action.kind !== "verify" || row.health?.actions[0] === action}
            />
            {health.dialogs}
            <ConfirmAction
                confirmation={confirmation}
                onOpenChange={(open) => !open && setConfirmation(null)}
            />
            <DeleteModelsDialog
                chosen={deleting}
                rows={models.data ?? []}
                onOpenChange={(open) => !open && setDeleting(null)}
                onDelete={async (cascade, cancelJobs) => {
                    await deleteModel(row, { cascade, undeploy: true, cancelJobs });
                    await refresh();
                    router.history.push(modelsHref());
                }}
            />
        </>
    );
}

function Overview({
    row,
    detail,
    base,
    versions,
}: {
    row: ModelRow;
    detail: ModelDetail | undefined;
    base: BaseModelDetail | undefined;
    versions: VersionInfo[];
}) {
    return (
        <OverviewLayout
            main={
                <>
                    {row.kind === "base" && <ModelHealth model={row.key} />}
                    <UsagePanel row={row} />
                    {row.kind === "base" ? (
                        <>
                            <BaseAbout row={row} base={base} />
                            <BaseDetails row={row} base={base} />
                        </>
                    ) : (
                        <>
                            <About row={row} detail={detail} versions={versions} />
                            <Details row={row} detail={detail} versions={versions} base={base} />
                        </>
                    )}
                </>
            }
            side={
                row.kind === "custom" ? (
                    <>
                        <ModelHealth model={row.key} />
                        <ActivityPanel row={row} />
                        <VersionsPanel row={row} versions={versions} />
                    </>
                ) : undefined
            }
        />
    );
}

function Files({
    row,
    open,
    base,
    versions,
}: {
    row: ModelRow;
    open: boolean;
    base: BaseModelDetail | undefined;
    versions: VersionInfo[];
}) {
    const models = useAllModels();
    const client = useQueryClient();
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const health = useHealthActions({
        refresh: () => client.invalidateQueries({ queryKey: keys.baseModel(row.key) }),
        confirm: setConfirmation,
        remove: () => undefined,
    });
    if (row.kind === "base") {
        return base ? (
            <FilesSheet row={row} open={open} description={verifiedText(base)}>
                <BaseFiles
                    model={base}
                    verify={() => health.run(row, { kind: "verify", label: "Verify files" })}
                />
                {health.dialogs}
                <ConfirmAction
                    confirmation={confirmation}
                    onOpenChange={(next) => !next && setConfirmation(null)}
                />
            </FilesSheet>
        ) : null;
    }
    const live = liveOf(versions);
    const baseName = baseNameOf(models.data, row.base_model);
    return (
        <FilesSheet row={row} open={open} description={adapterText(live, baseName)}>
            <CustomFiles
                slug={row.key}
                live={live}
                base={row.base_model ?? ""}
                baseName={baseName}
            />
        </FilesSheet>
    );
}

function Loaded({ row }: { row: ModelRow }) {
    const can = useCan();
    const custom = row.kind === "custom";
    const detail = useModel(custom ? row.key : "");
    const base = useBaseModel(custom ? (row.base_model ?? "") : row.key);
    const versions = useVersions(custom ? row.key : "");
    const tab = useModelTab(row, can.build);
    const list = custom ? (versions.data ?? []) : [];
    const tabs = tabsFor(row, can.build);
    useScrollToHash(Boolean(detail.data) || !custom);
    const modelDetail = custom ? detail.data : undefined;
    return (
        <Page wide>
            <ModelHeader
                row={row}
                base={base.data}
                activity={
                    list.some(inFlight) ? <VersionActivity row={row} versions={list} /> : undefined
                }
                actions={
                    <ModelActions row={row} detail={modelDetail} base={base.data} versions={list} />
                }
            />
            <TabNav
                label={`${row.name} pages`}
                tabs={tabs.map((item) => ({
                    href: modelPageHref(row.key, item),
                    label: TAB_LABELS[item],
                }))}
            />
            <Notices row={row} />
            {custom && versions.error && !versions.data ? (
                <QueryError error={versions.error} retry={versions.refetch} />
            ) : (
                <div>
                    {(tab === "overview" || tab === "files") && (
                        <Overview row={row} detail={modelDetail} base={base.data} versions={list} />
                    )}
                    {tab === "versions" && <VersionsTab row={row} versions={list} />}
                    {tab === "evaluation" && (
                        <EvaluationTab row={row} detail={modelDetail} versions={list} />
                    )}
                    {tab === "monitoring" && <MonitoringTab row={row} versions={list} />}
                    {tab === "api" && <KeysTab row={row} />}
                    {tab === "activity" && <ActivityTab row={row} />}
                    {tab === "settings" && <SettingsTab row={row} detail={modelDetail} />}
                </div>
            )}
            <Files row={row} open={tab === "files"} base={base.data} versions={list} />
        </Page>
    );
}

export function ModelPage() {
    const lookup = useRow();
    if (!lookup.row) {
        return <Missing lookup={lookup} />;
    }
    return <Loaded key={lookup.row.key} row={lookup.row} />;
}

export function ModelVersionPage() {
    const lookup = useRow();
    const number = useVersionNumber();
    if (!lookup.row || lookup.row.kind !== "custom") {
        return <Missing lookup={lookup} />;
    }
    return <VersionView key={`${lookup.row.key}:${number}`} row={lookup.row} number={number} />;
}

export function ModelComparePage() {
    const lookup = useRow();
    if (!lookup.row || lookup.row.kind !== "custom") {
        return <Missing lookup={lookup} />;
    }
    return <CompareView row={lookup.row} />;
}

export function OldModelLink() {
    const params = useParams({ strict: false }) as { key?: string; slug?: string; number?: string };
    const router = useRouter();
    const name = params.key ?? params.slug ?? "";
    const target = params.number
        ? `${modelPageHref(name)}/versions/${params.number}/card`
        : modelPageHref(name);
    useEffect(() => {
        router.history.replace(target);
    }, [router, target]);
    return null;
}
