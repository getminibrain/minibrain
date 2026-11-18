import {
    IconArrowRight,
    IconFileImport,
    IconFolder,
    IconFolderDown,
    IconFolderPlus,
    IconLayoutGridAdd,
    IconPencil,
    IconStack2,
    IconTable,
    IconTrash,
} from "@tabler/icons-react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
    Badge,
    DropZone,
    DropdownMenuItem,
    DropdownMenuSeparator,
    FileName,
    SearchInput,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    Tree,
    type TreeNode,
    TreeRowMenu,
    ancestorsOf,
    filterTree,
} from "obp-ui";
import {
    type CSSProperties,
    type KeyboardEvent,
    type ReactNode,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { DatasetSummary, SourceAdded, SourceSummary } from "~/api/client";
import { type DatasetFolder, useDatasetFolders, useFolderRoots } from "~/api/dataQueries";
import { useDatasets, useSources } from "~/api/queries";
import { NotFoundState, QueryError } from "~/components/ErrorState";
import { PageHeader } from "~/components/PageHeader";
import { ErrorLine, Stat, pageFrame } from "~/components/Section";
import { DATA_FILE_TYPES } from "~/lib/dataFiles";
import { count } from "~/lib/format";
import { useSearchParam } from "~/lib/listSearch";
import { bytes } from "~/lib/time";
import { useResizableWidth } from "~/lib/useResizableWidth";
import { useStoredList } from "~/lib/useStoredList";
import { AddMenu, SourceChoices, useSourceBlocks } from "./AddMenu";
import {
    type AddKind,
    AlreadyAddedDialog,
    type SourceAdder,
    addSourceKind,
    useSourceAdder,
} from "./AddSource";
import { AddDatabaseDialog, AddS3Dialog, ConnectedGroup } from "./Connected";
import { CreateDataset, DatasetDetail } from "./DatasetDetail";
import { DatasetsRoot, FolderDetail, folderOf, folderRef, useMoveItem } from "./DatasetFolders";
import { FileDetail } from "./FileDetail";
import { AddFolderDialog, FoldersGroup } from "./Folders";
import { AddLakehouseDialog, LakehouseGroup } from "./Lakehouse";
import { MakeDatasetDialog, SourceTable } from "./SourceTable";
import { SourcesOverview } from "./Sources";
import { type TreeAction, TreeActionDialogs, useRemoveItem } from "./TreeActions";
import {
    DATASETS_GROUP,
    DATA_PATH,
    type FolderIndex,
    type ItemRef,
    SOURCES_GROUP,
    SOURCE_GROUPS,
    type SourceGroupId,
    TABLE_FORMATS,
    datasetNamed,
    datasetText,
    datasetsInside,
    folderIndex,
    groupOf,
    inGroup,
    itemHref,
    parseItem,
    siblingNamed,
    sourceRef,
    sourceText,
    tableFormat,
    usesSource,
} from "./catalogue";
import { GroupIcon, SourceIcon } from "./icons";
import { FILL, useDataRefresh } from "./parts";

const TREE_WIDTH = { key: "minibrain.data.treeWidth", initial: 288, min: 200, max: 520 };
const DEFAULT_ITEM: ItemRef = DATASETS_GROUP;

function linked(node: TreeNode): TreeNode {
    return { ...node, href: node.id, children: node.children?.map(linked) };
}

function sourceNode(source: SourceSummary): TreeNode {
    const id = itemHref(sourceRef(source));
    const format = tableFormat(source.kind);
    if (format) {
        return {
            id,
            label: source.name,
            icon: <SourceIcon source={source} />,
            meta: <Badge variant="outline">{TABLE_FORMATS[format].short}</Badge>,
        };
    }
    if (source.kind !== "upload") {
        return { id, label: source.name, icon: <SourceIcon source={source} /> };
    }
    return {
        id,
        label: <FileName name={source.name} />,
        textValue: source.name,
        icon: <SourceIcon source={source} />,
    };
}

function folderNodes(index: FolderIndex, parent: number | null): TreeNode[] {
    const folders = (index.folders.get(parent) ?? []).map((folder) => ({
        id: itemHref({ kind: "folder", id: folder.id }),
        label: folder.name,
        icon: <IconFolder />,
        meta: datasetsInside(index, folder.id).length,
        draggable: true,
        droppable: true,
        children: folderNodes(index, folder.id),
    }));
    const datasets = (index.datasets.get(parent) ?? []).map((dataset) => ({
        id: itemHref({ kind: "dataset", id: dataset.slug }),
        label: dataset.name,
        icon: <IconTable />,
        draggable: true,
    }));
    return [...folders, ...datasets];
}

function buildTree(
    sources: SourceSummary[],
    datasets: DatasetSummary[],
    index: FolderIndex,
): TreeNode[] {
    const datasetGroup: TreeNode = {
        id: itemHref(DATASETS_GROUP),
        label: "Datasets",
        icon: <IconStack2 />,
        meta: datasets.length,
        droppable: true,
        children: folderNodes(index, null),
    };
    const sourceGroups = SOURCE_GROUPS.map((group) => {
        const members = sources.filter((source) => inGroup(source, group));
        return {
            id: itemHref({ kind: "group", id: group.id }),
            label: group.label,
            icon: <GroupIcon group={group.id} />,
            meta: members.length,
            children: members.map(sourceNode),
        };
    });
    const sourcesGroup: TreeNode = {
        id: itemHref(SOURCES_GROUP),
        label: "Sources",
        icon: <IconFileImport />,
        meta: sources.length,
        children: sourceGroups,
    };
    return [datasetGroup, sourcesGroup].map(linked);
}

function searchIndex(
    sources: SourceSummary[],
    datasets: DatasetSummary[],
    folders: DatasetFolder[],
): Map<string, string> {
    const index = new Map<string, string>();
    index.set(itemHref(DATASETS_GROUP), "datasets");
    index.set(itemHref(SOURCES_GROUP), "sources");
    for (const { id, label } of SOURCE_GROUPS) {
        index.set(itemHref({ kind: "group", id }), label.toLowerCase());
    }
    for (const folder of folders) {
        index.set(itemHref({ kind: "folder", id: folder.id }), folder.name.toLowerCase());
    }
    for (const source of sources) {
        index.set(itemHref(sourceRef(source)), sourceText(source));
    }
    for (const dataset of datasets) {
        index.set(itemHref({ kind: "dataset", id: dataset.slug }), datasetText(dataset));
    }
    return index;
}

function allBranches(nodes: TreeNode[]): string[] {
    return nodes.flatMap((node) =>
        node.children?.length ? [node.id, ...allBranches(node.children)] : [],
    );
}

function GroupDetail({
    kind,
    sources,
    datasets,
    adder,
    picked,
    onPick,
    onMake,
    onSelect,
}: {
    kind: SourceGroupId;
    sources: SourceSummary[];
    datasets: DatasetSummary[];
    adder: SourceAdder;
    picked: string[];
    onPick: (ids: string[]) => void;
    onMake: (sources: SourceSummary[]) => void;
    onSelect: (item: ItemRef) => void;
}) {
    const grouped = sources.filter((source) => groupOf(source.kind).id === kind);
    const table = grouped.length > 0 && (
        <SourceTable
            sources={grouped}
            selected={picked}
            onSelectedChange={onPick}
            onMake={onMake}
            onSelect={onSelect}
        />
    );
    if (kind !== "upload") {
        return (
            <div className={`${FILL} gap-6`}>
                {kind === "folder" ? (
                    <FoldersGroup sources={sources} datasets={datasets} />
                ) : kind === "lakehouse" ? (
                    <LakehouseGroup sources={sources} datasets={datasets} />
                ) : (
                    <ConnectedGroup kind={kind} sources={sources} datasets={datasets} />
                )}
                {table}
            </div>
        );
    }
    const members = grouped;
    const ids = new Set(members.map((source) => source.id));
    const built = datasets.filter((dataset) =>
        dataset.sources.some((source) => ids.has(source.id)),
    );
    return (
        <div className={`${FILL} gap-6`}>
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <h2 className="text-2xl font-semibold">Uploads</h2>
                    <p className="text-muted-foreground">
                        Files copied into this install, stored once and shared by every model.
                    </p>
                </div>
            </header>
            <div className="flex flex-wrap gap-x-8 gap-y-3">
                <Stat label="Files" value={count(members.length)} />
                <Stat label="Datasets" value={count(built.length)} />
                <Stat
                    label="Stored"
                    value={bytes(members.reduce((sum, source) => sum + source.size, 0))}
                />
            </div>
            <DropZone
                accept={DATA_FILE_TYPES}
                disabled={adder.pending !== null}
                title={adder.pending === "upload" ? "Uploading…" : "Drop a data file here"}
                activeTitle="Drop to upload"
                description={
                    members.length === 0
                        ? "CSV, TSV, JSON, JSON Lines or Parquet. Then make a dataset from it, or start from demo data under Add."
                        : "CSV, TSV, JSON, JSON Lines or Parquet. A file already uploaded is not stored twice."
                }
                inputLabel="Data file to upload"
                onFiles={adder.drop}
            />
            {table}
        </div>
    );
}

function DeleteItem({ blocked, onSelect }: { blocked: string | null; onSelect: () => void }) {
    return (
        <DropdownMenuItem variant="destructive" disabled={blocked !== null} onSelect={onSelect}>
            <IconTrash />
            Delete
            {blocked && (
                <span className="ml-auto pl-3 text-sm text-muted-foreground">{blocked}</span>
            )}
        </DropdownMenuItem>
    );
}

const MISSING_TITLE: Record<ItemRef["kind"], string> = {
    group: "Group not found",
    source: "Source not found",
    folder: "Folder not found",
    dataset: "Dataset not found",
};

function Missing({ item }: { item: ItemRef | null }) {
    return (
        <NotFoundState
            heading="h2"
            title={item ? MISSING_TITLE[item.kind] : "Page not found"}
            primary={{ label: "Go to Data", href: DATA_PATH }}
        >
            {item
                ? `No ${item.kind} matches this link. It may have been deleted or moved.`
                : "Nothing on the Data page matches this link."}
        </NotFoundState>
    );
}

function sourceAt(sources: SourceSummary[], item: ItemRef): SourceSummary | undefined {
    const found =
        item.kind === "source" ? sources.find((source) => source.id === item.id) : undefined;
    return found && item.kind === "source" && groupOf(found.kind).id === item.group
        ? found
        : undefined;
}

export function DataExplorer() {
    const router = useRouter();
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const requested = parseItem(pathname);
    const unknownPath = requested === null && pathname.replace(/\/+$/, "") !== DATA_PATH;
    const startAdding = useSearchParam("add") !== null;
    const sources = useSources();
    const datasets = useDatasets();
    const folders = useDatasetFolders();
    const refresh = useDataRefresh();
    const move = useMoveItem();
    const width = useResizableWidth(TREE_WIDTH);
    const [query, setQuery] = useState("");
    const [collapsed, setCollapsed] = useStoredList("minibrain.data.collapsed");
    const [creatingFor, setCreatingFor] = useState<number | string | null>(null);
    const [adding, setAdding] = useState<AddKind | null>(null);
    const [already, setAlready] = useState<SourceSummary | null>(null);
    const [picked, setPicked] = useState<{ scope: string; ids: string[] }>({
        scope: "",
        ids: [],
    });
    const [making, setMaking] = useState<SourceSummary[] | null>(null);
    const roots = useFolderRoots();
    const treeBox = useRef<HTMLDivElement>(null);
    const loading = sources.isLoading || datasets.isLoading || folders.isLoading;
    const sourceList = useMemo(() => sources.data ?? [], [sources.data]);
    const datasetList = useMemo(() => datasets.data ?? [], [datasets.data]);
    const folderList = useMemo(() => folders.data ?? [], [folders.data]);
    const selected = requested ?? DEFAULT_ITEM;
    const selectedKey = itemHref(selected);
    const index = useMemo(() => folderIndex(folderList, datasetList), [folderList, datasetList]);
    const nodes = useMemo(
        () => buildTree(sourceList, datasetList, index),
        [sourceList, datasetList, index],
    );
    const haystacks = useMemo(
        () => searchIndex(sourceList, datasetList, folderList),
        [sourceList, datasetList, folderList],
    );
    const branches = useMemo(() => allBranches(nodes), [nodes]);
    const text = query.trim().toLowerCase();
    const filtered = useMemo(
        () =>
            text
                ? filterTree(nodes, (node) => haystacks.get(node.id)?.includes(text) ?? false)
                : null,
        [nodes, haystacks, text],
    );
    const expanded = branches.filter((id) => !collapsed.includes(id));
    const matches = text
        ? [...haystacks.entries()].filter(
              ([id, value]) => parseItem(id)?.kind !== "group" && value.includes(text),
          ).length
        : 0;

    useEffect(() => {
        const above = ancestorsOf(nodes, selectedKey);
        setCollapsed((current) =>
            above.some((id) => current.includes(id))
                ? current.filter((id) => !above.includes(id))
                : current,
        );
    }, [nodes, selectedKey, setCollapsed]);

    const select = (item: ItemRef) => {
        const href = itemHref(item);
        if (href !== selectedKey) {
            setCreatingFor(null);
        }
        if (href !== pathname) {
            router.history.push(href);
        }
    };

    const onSelectKey = (key: string) => {
        const item = parseItem(key);
        if (item) {
            select(item);
        }
    };

    const add = (kind: AddKind) => setAdding(kind);

    const onMove = (id: string, targetId: string) => {
        const item = parseItem(id);
        const into = folderOf(parseItem(targetId));
        if (into !== undefined && (item?.kind === "dataset" || item?.kind === "folder")) {
            move.mutate({ item, into });
        }
    };

    const canDrop = (node: TreeNode, target: TreeNode) => {
        const item = parseItem(node.id);
        const into = folderOf(parseItem(target.id));
        if (into === undefined || (item?.kind !== "dataset" && item?.kind !== "folder")) {
            return false;
        }
        if (item.kind === "dataset") {
            const dataset = datasetList.find((row) => row.slug === item.id);
            return !dataset || !datasetNamed(index.datasets.get(into) ?? [], dataset.name, item.id);
        }
        const folder = index.byId.get(item.id);
        return !folder || !siblingNamed(index, into, folder.name, folder.id);
    };

    const onUploaded = (source: SourceAdded) => {
        if (source.outcome === "existing") {
            setAlready(source);
            return;
        }
        setQuery("");
        router.history.push(itemHref(sourceRef(source)));
        setCreatingFor(source.outcome === "created" ? source.id : null);
    };

    const adder = useSourceAdder(onUploaded);
    const addKind = addSourceKind(adder, add);
    const blocks = useSourceBlocks();
    const pickedIds = picked.scope === selectedKey ? picked.ids : [];
    const pickedSources = sourceList.filter((source) => pickedIds.includes(String(source.id)));
    const [action, setAction] = useState<TreeAction | null>(null);
    const remove = useRemoveItem(selected, select);

    const focusTreeRow = () => {
        window.requestAnimationFrame(() =>
            treeBox.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus(),
        );
    };

    const createIn = (item: ItemRef, key: number | string) => {
        select(item);
        setCreatingFor(key);
    };

    const currentFolder = (): number | null => {
        const id =
            selected.kind === "folder"
                ? selected.id
                : selected.kind === "dataset"
                  ? (datasetList.find((row) => row.slug === selected.id)?.folder_id ?? null)
                  : null;
        return id !== null && index.byId.has(id) ? id : null;
    };

    const newDataset = () => {
        const source = sourceAt(sourceList, selected);
        if (source) {
            setCreatingFor(source.id);
            return;
        }
        const folder = currentFolder();
        const into = folderRef(folder);
        createIn(into, folder === null ? "new" : itemHref(into));
    };

    const fromSources = () => {
        if (pickedSources.length > 0) {
            setMaking(pickedSources);
            return;
        }
        select({ kind: "group", id: "upload" });
    };

    const menuFor = (node: TreeNode): ReactNode => {
        const item = parseItem(node.id);
        if (!item) {
            return null;
        }
        const name = node.textValue ?? (typeof node.label === "string" ? node.label : node.id);
        const label = `Actions for ${name}`;
        const open = (
            <DropdownMenuItem onSelect={() => select(item)}>
                <IconArrowRight />
                Open
            </DropdownMenuItem>
        );
        if (item.kind === "group" && item.id === "datasets") {
            return (
                <TreeRowMenu label={label}>
                    <DropdownMenuItem onSelect={() => createIn(DATASETS_GROUP, "new")}>
                        <IconLayoutGridAdd />
                        New dataset
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => setAction({ kind: "new-folder", parentId: null })}
                    >
                        <IconFolderPlus />
                        New folder
                    </DropdownMenuItem>
                </TreeRowMenu>
            );
        }
        if (item.kind === "group") {
            return (
                <TreeRowMenu label={label}>
                    <SourceChoices
                        groups={item.id === "sources" ? undefined : [item.id as SourceGroupId]}
                        blocks={blocks}
                        onPick={addKind}
                    />
                </TreeRowMenu>
            );
        }
        if (item.kind === "folder") {
            const folder = index.byId.get(item.id);
            if (!folder) {
                return null;
            }
            return (
                <TreeRowMenu label={label}>
                    <DropdownMenuItem onSelect={() => createIn(item, itemHref(item))}>
                        <IconLayoutGridAdd />
                        New dataset
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => setAction({ kind: "new-folder", parentId: folder.id })}
                    >
                        <IconFolderPlus />
                        New folder
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setAction({ kind: "rename-folder", folder })}>
                        <IconPencil />
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() =>
                            setAction({
                                kind: "move",
                                target: { item, name: folder.name, from: folder.parent_id },
                            })
                        }
                    >
                        <IconFolderDown />
                        Move to…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setAction({ kind: "delete-folder", folder })}
                    >
                        <IconTrash />
                        Delete
                    </DropdownMenuItem>
                </TreeRowMenu>
            );
        }
        if (item.kind === "dataset") {
            const dataset = datasetList.find((row) => row.slug === item.id);
            if (!dataset) {
                return null;
            }
            return (
                <TreeRowMenu label={label}>
                    {open}
                    <DropdownMenuItem
                        onSelect={() => setAction({ kind: "rename-dataset", dataset })}
                    >
                        <IconPencil />
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() =>
                            setAction({
                                kind: "move",
                                target: {
                                    item,
                                    name: dataset.name,
                                    from: dataset.folder_id ?? null,
                                },
                            })
                        }
                    >
                        <IconFolderDown />
                        Move to…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DeleteItem
                        blocked={dataset.delete_lock ? "A job uses it" : null}
                        onSelect={() => setAction({ kind: "delete-dataset", dataset })}
                    />
                </TreeRowMenu>
            );
        }
        const source = sourceList.find((row) => row.id === item.id);
        if (!source) {
            return null;
        }
        const readers = datasetList.filter((dataset) => usesSource(dataset, source.id)).length;
        return (
            <TreeRowMenu label={label}>
                {open}
                <DropdownMenuItem onSelect={() => createIn(item, source.id)}>
                    <IconLayoutGridAdd />
                    New dataset
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAction({ kind: "rename-source", source })}>
                    <IconPencil />
                    Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DeleteItem
                    blocked={readers > 0 ? "Used by datasets" : null}
                    onSelect={() => setAction({ kind: "delete-source", source })}
                />
            </TreeRowMenu>
        );
    };

    const focusTree = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            const stop = treeBox.current?.querySelector<HTMLElement>(
                '[role="treeitem"][tabindex="0"]',
            );
            if (stop) {
                event.preventDefault();
                stop.focus();
            }
        }
    };

    const created = async (dataset: DatasetSummary) => {
        await refresh();
        setCreatingFor(null);
        select({ kind: "dataset", id: dataset.slug });
    };

    const listError = sources.error ?? datasets.error ?? folders.error;
    const retryLists = () =>
        Promise.all([sources.refetch(), datasets.refetch(), folders.refetch()]);
    let detail: ReactNode = null;
    let split = false;
    if (unknownPath) {
        detail = <Missing item={null} />;
    } else if (listError) {
        detail = <QueryError heading="h2" error={listError} retry={retryLists} />;
    } else if (!loading) {
        if (selected.kind === "group" && selected.id === "datasets") {
            detail = (
                <div className={creatingFor === "new" ? "flex flex-col gap-6" : `${FILL} gap-6`}>
                    <DatasetsRoot
                        datasets={datasetList}
                        index={index}
                        creating={creatingFor === "new"}
                        onSelect={select}
                        onNewDataset={creatingFor === "new" ? undefined : newDataset}
                    />
                    {creatingFor === "new" && (
                        <CreateDataset
                            sources={sourceList}
                            onCancel={() => setCreatingFor(null)}
                            onCreated={created}
                        />
                    )}
                </div>
            );
        } else if (selected.kind === "group" && selected.id === "sources") {
            detail = (
                <SourcesOverview sources={sourceList} datasets={datasetList} onSelect={select} />
            );
        } else if (selected.kind === "group") {
            detail = (
                <GroupDetail
                    kind={selected.id as SourceGroupId}
                    sources={sourceList}
                    datasets={datasetList}
                    adder={adder}
                    picked={pickedIds}
                    onPick={(ids) => setPicked({ scope: selectedKey, ids })}
                    onMake={setMaking}
                    onSelect={select}
                />
            );
        } else if (selected.kind === "source") {
            const source = sourceAt(sourceList, selected);
            split = Boolean(source);
            detail = source ? (
                <FileDetail
                    key={selectedKey}
                    source={source}
                    sources={sourceList}
                    datasets={datasetList.filter((dataset) => usesSource(dataset, source.id))}
                    creating={creatingFor === source.id}
                    onCreating={(on) => setCreatingFor(on ? source.id : null)}
                    onSelect={select}
                />
            ) : (
                <Missing item={selected} />
            );
        } else if (selected.kind === "folder") {
            const folder = index.byId.get(selected.id);
            detail = folder ? (
                <div
                    className={
                        creatingFor === selectedKey ? "flex flex-col gap-6" : `${FILL} gap-6`
                    }
                >
                    <FolderDetail
                        key={selectedKey}
                        folder={folder}
                        index={index}
                        creating={creatingFor === selectedKey}
                        onSelect={select}
                        onNewDataset={creatingFor === selectedKey ? undefined : newDataset}
                    />
                    {creatingFor === selectedKey && (
                        <CreateDataset
                            sources={sourceList}
                            folderId={folder.id}
                            onCancel={() => setCreatingFor(null)}
                            onCreated={created}
                        />
                    )}
                </div>
            ) : (
                <Missing item={selected} />
            );
        } else {
            const dataset = datasetList.find((item) => item.slug === selected.id);
            split = Boolean(dataset);
            detail = dataset ? (
                <DatasetDetail
                    key={selectedKey}
                    dataset={dataset}
                    sources={sourceList}
                    index={index}
                    onSelect={select}
                />
            ) : (
                <Missing item={selected} />
            );
        }
    }

    return (
        <div className="@container/data flex min-h-0 flex-1 flex-col">
            <div className={pageFrame("full")}>
                <PageHeader
                    title="Data"
                    caption="Datasets, the sources their queries read and the models that train on them."
                />
                <ErrorLine error={adder.error} />
                {adder.picker}
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t @3xl:flex-row @3xl:overflow-hidden">
                <aside
                    aria-label="Data catalogue"
                    className="relative flex max-h-80 shrink-0 flex-col border-b @3xl:max-h-none @3xl:w-(--tree-width) @3xl:border-r @3xl:border-b-0"
                    style={
                        {
                            "--tree-width": `${width.width ?? TREE_WIDTH.initial}px`,
                        } as CSSProperties
                    }
                >
                    <div className="flex flex-col gap-1 border-b p-2">
                        <div className="flex items-center gap-1">
                            <SearchInput
                                aria-label="Search data"
                                placeholder="Search names, columns"
                                value={query}
                                onValueChange={setQuery}
                                onKeyDown={focusTree}
                                className="min-w-0 flex-1"
                            />
                            <AddMenu
                                adder={adder}
                                picked={pickedSources.length}
                                onAdd={add}
                                onNewDataset={newDataset}
                                onNewFolder={() =>
                                    setAction({ kind: "new-folder", parentId: currentFolder() })
                                }
                                onFromSources={fromSources}
                                startOpen={startAdding}
                            />
                        </div>
                        {text && (
                            <p
                                className="px-1 text-sm text-muted-foreground tabular-nums"
                                aria-live="polite"
                            >
                                {matches === 0
                                    ? "No matches"
                                    : `${count(matches)} match${matches === 1 ? "" : "es"}`}
                            </p>
                        )}
                        <ErrorLine error={move.error ?? remove.error} />
                    </div>
                    <div ref={treeBox} className="min-h-0 flex-1 overflow-y-auto">
                        {loading ? (
                            <p className="p-3 text-muted-foreground">Loading…</p>
                        ) : (
                            <>
                                <Tree
                                    aria-label="Datasets and sources"
                                    nodes={filtered?.nodes ?? nodes}
                                    selectedId={unknownPath ? null : selectedKey}
                                    onSelect={onSelectKey}
                                    expandedIds={
                                        filtered ? [...expanded, ...filtered.expandedIds] : expanded
                                    }
                                    onExpandedChange={(next) =>
                                        setCollapsed(branches.filter((id) => !next.includes(id)))
                                    }
                                    onMove={onMove}
                                    canDrop={canDrop}
                                    rowActions={menuFor}
                                    empty={
                                        <p className="p-3 text-muted-foreground">
                                            Nothing matches. Search looks in names, column names,
                                            descriptions and tags.
                                        </p>
                                    }
                                />
                                {!text && sourceList.length === 0 && (
                                    <p className="pr-3 pb-3 pl-11 text-muted-foreground">
                                        No sources yet. Use Add to upload a file, read a folder,
                                        bucket or database, or try demo data.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                aria-label="Resize the list"
                                onPointerDown={width.onPointerDown}
                                onKeyDown={width.onKeyDown}
                                onDoubleClick={width.reset}
                                className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize touch-none outline-none select-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 hover:after:bg-primary focus-visible:after:bg-primary @3xl:block"
                            />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                            Drag to resize, double-click to reset
                        </TooltipContent>
                    </Tooltip>
                </aside>
                <section
                    aria-label="Details"
                    className={
                        split
                            ? "flex min-w-0 flex-1 flex-col @3xl:min-h-0"
                            : "flex min-w-0 flex-1 flex-col px-6 py-6 @3xl:overflow-y-auto"
                    }
                >
                    {detail}
                </section>
            </div>
            <AlreadyAddedDialog
                source={already}
                onOpenChange={(open) => !open && setAlready(null)}
                onOpen={(source) => {
                    setQuery("");
                    select(sourceRef(source));
                }}
            />
            <MakeDatasetDialog
                sources={making}
                onOpenChange={(open) => !open && setMaking(null)}
                onCreated={async (dataset) => {
                    setPicked({ scope: "", ids: [] });
                    await created(dataset);
                }}
            />
            <TreeActionDialogs
                action={action}
                index={index}
                sources={sourceList}
                onClose={() => {
                    setAction(null);
                    focusTreeRow();
                }}
                onSelect={select}
                onRemove={(removal) => remove.mutateAsync(removal)}
            />
            <AddFolderDialog
                open={adding === "folder"}
                roots={roots.data?.roots ?? []}
                onOpenChange={(open) => setAdding(open ? "folder" : null)}
                onAdded={onUploaded}
            />
            <AddS3Dialog
                open={adding === "s3"}
                onOpenChange={(open) => setAdding(open ? "s3" : null)}
                onAdded={onUploaded}
            />
            <AddDatabaseDialog
                open={adding === "database"}
                onOpenChange={(open) => setAdding(open ? "database" : null)}
                onAdded={onUploaded}
            />
            <AddLakehouseDialog
                open={adding === "lakehouse"}
                roots={roots.data?.roots ?? []}
                onOpenChange={(open) => setAdding(open ? "lakehouse" : null)}
                onAdded={onUploaded}
            />
        </div>
    );
}
