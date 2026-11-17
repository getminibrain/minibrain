import { IconDownload, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    cn,
} from "obp-ui";
import type { ReactNode } from "react";
import {
    type ExportInfo,
    type ModelRow,
    type VersionFiles,
    type VersionInfo,
    api,
    unwrap,
} from "~/api/client";
import { keys, useVersionExports, useVersionFiles } from "~/api/queries";
import { StatusText, percentOf } from "~/components/models/StatusText";
import { bytes } from "~/lib/time";
import { Mono } from "./facts";

const MERGED_FORMAT = "safetensors";

function artifactHref(id: string): string {
    return `/api/artifacts/${id}`;
}

function DownloadButton({ id, filename }: { id: string | null; filename?: string | null }) {
    if (!id) {
        return (
            <Button variant="outline" disabled>
                <IconDownload aria-hidden="true" />
                Download
            </Button>
        );
    }
    return (
        <Button variant="outline" asChild>
            <a href={artifactHref(id)} download={filename ?? true}>
                <IconDownload aria-hidden="true" />
                Download
            </a>
        </Button>
    );
}

function Sha({ value }: { value: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-muted-foreground">SHA-256</span>
            <Mono value={value} label="Copy SHA-256" />
        </span>
    );
}

function FormatRow({
    label,
    meta,
    runs,
    note,
    status,
    action,
    muted = false,
}: {
    label: string;
    meta: string;
    runs: string;
    note?: string;
    status?: ReactNode;
    action: ReactNode;
    muted?: boolean;
}) {
    return (
        <li className="flex items-start gap-4 px-3 py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className={cn("font-medium", muted && "text-muted-foreground")}>
                        {label}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">{meta}</span>
                </span>
                <span className="text-sm text-muted-foreground">{runs}</span>
                {note && <span className="text-sm text-muted-foreground">{note}</span>}
                {status !== undefined && (
                    <span className="flex h-8 min-w-0 items-center text-sm">{status}</span>
                )}
            </span>
            <span className="flex w-28 shrink-0 justify-end">{action}</span>
        </li>
    );
}

function AdapterRow({ files }: { files: VersionFiles | undefined }) {
    const sha = files?.artifact_id ?? null;
    return (
        <FormatRow
            label="Adapter only"
            meta={files?.size ? `safetensors · ${bytes(files.size)}` : "safetensors"}
            runs="Loads on the same base in minibrain, vLLM or PEFT."
            status={
                sha ? <Sha value={sha} /> : <span className="text-muted-foreground">Loading</span>
            }
            action={<DownloadButton id={sha} filename={null} />}
        />
    );
}

function mergedStatus(found: ExportInfo | undefined, problem: string | null): ReactNode {
    if (problem) {
        return (
            <span className="min-w-0 truncate text-destructive" title={problem}>
                {problem}
            </span>
        );
    }
    if (!found) {
        return <span className="text-muted-foreground">Not exported yet.</span>;
    }
    if (found.state === "queued") {
        return (
            <StatusText tone="neutral" waiting>
                Waiting for a worker
            </StatusText>
        );
    }
    if (found.state === "running") {
        const share = found.progress ?? 0;
        return (
            <StatusText
                tone="info"
                progress={share > 0 ? percentOf(share) : null}
                active={share === 0}
            >
                <span className="tabular-nums">{`Merging ${Math.round(share * 100)}%`}</span>
            </StatusText>
        );
    }
    if (found.state === "ready" && found.artifact_id) {
        return <Sha value={found.artifact_id} />;
    }
    const why = found.error ?? (found.state === "cancelled" ? "Cancelled" : "Failed");
    return (
        <span className="flex min-w-0 items-center">
            <StatusText tone="destructive" className="min-w-0">
                <span className="truncate" title={why}>
                    {why}
                </span>
            </StatusText>
        </span>
    );
}

function MergedRow({ row, version, open }: { row: ModelRow; version: VersionInfo; open: boolean }) {
    const client = useQueryClient();
    const exports = useVersionExports(row.key, open ? version.number : null);
    const found = exports.data?.find((item) => item.format === MERGED_FORMAT);
    const start = useMutation({
        mutationFn: () =>
            unwrap(
                api.POST("/api/models/{name}/versions/{number}/exports", {
                    params: { path: { name: row.key, number: version.number } },
                    body: { format: MERGED_FORMAT },
                }),
            ),
        onSuccess: (started) => {
            client.setQueryData<ExportInfo[]>(
                keys.versionExports(row.key, version.number),
                (old) => [...(old ?? []).filter((item) => item.format !== started.format), started],
            );
        },
    });
    const problem = start.error ? start.error.message : null;
    const ready = found?.state === "ready";
    const ended = found?.state === "failed" || found?.state === "cancelled";
    const busy = found?.state === "queued" || found?.state === "running";
    let action: ReactNode;
    if (ready || busy) {
        action = <DownloadButton id={found.artifact_id} filename={found.filename} />;
    } else if (ended) {
        action = (
            <Button variant="outline" disabled={start.isPending} onClick={() => start.mutate()}>
                <IconRefresh aria-hidden="true" />
                Try again
            </Button>
        );
    } else {
        action = (
            <Button
                variant="outline"
                disabled={start.isPending || exports.isPending}
                onClick={() => start.mutate()}
            >
                Export
            </Button>
        );
    }
    return (
        <FormatRow
            label="Merged full model"
            meta={ready && found.size ? `safetensors · ${bytes(found.size)}` : "safetensors"}
            runs="The base with the adapter folded in; runs on any server for Hugging Face models."
            note="QLoRA adapters merge onto the bf16 base, not the 4-bit one."
            status={mergedStatus(found, problem)}
            action={action}
        />
    );
}

export function ExportDialog({
    row,
    version,
    open,
    onOpenChange,
}: {
    row: ModelRow;
    version: VersionInfo;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const files = useVersionFiles(row.key, open ? version.number : null);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{`Export v${version.number}`}</DialogTitle>
                    <DialogDescription>
                        {`Files of ${row.name} v${version.number} you can run elsewhere. Each carries its SHA-256.`}
                    </DialogDescription>
                </DialogHeader>
                <ul className="flex min-w-0 flex-col divide-y rounded-md border">
                    <AdapterRow files={files.data} />
                    <MergedRow row={row} version={version} open={open} />
                    <FormatRow
                        label="Merged and quantised GGUF"
                        meta="GGUF"
                        runs="For llama.cpp or Ollama, on a laptop or CPU server."
                        action={<Badge variant="neutral">Coming soon</Badge>}
                        muted
                    />
                </ul>
                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
