import { IconDeviceSdCard, IconFileText, IconPackages } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Input,
    Label,
    Link,
    RadioGroup,
    RadioGroupItem,
    SettingsGroup,
    SettingsRow,
} from "obp-ui";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { api, unwrap } from "~/api/client";
import type { components } from "~/api/schema";
import { NumberSettingRow } from "~/components/NumberSettingRow";
import { ErrorLine } from "~/components/Section";
import { SettingsLayout } from "~/components/SettingsLayout";
import { SettingsSection, SettingsSections } from "~/components/SettingsSection";
import { SourceBadge } from "~/components/SourceBadge";
import { StatusText } from "~/components/models/StatusText";
import { STORAGE, type Setting } from "~/pages/settings/settingsIndex";

type StorageSettings = components["schemas"]["StorageSettings"];
type StorageUpdate = components["schemas"]["StorageUpdate"];

const STORAGE_KEY = ["settings", "storage"] as const;
const JOB_LOGS_KEY = ["settings", "job-logs"] as const;
const WHOLE: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const TEXT = STORAGE.location.settings;

type Draft = {
    kind: StorageUpdate["kind"];
    endpoint: string;
    bucket: string;
    prefix: string;
    region: string;
    access_key: string;
    secret: string;
};

function draftOf(settings: StorageSettings): Draft {
    return {
        kind: settings.kind,
        endpoint: settings.endpoint,
        bucket: settings.bucket,
        prefix: settings.prefix,
        region: settings.region,
        access_key: settings.access_key,
        secret: "",
    };
}

function bodyOf(draft: Draft): StorageUpdate {
    return { ...draft, secret: draft.secret || null };
}

function TextField({
    id,
    text,
    hint,
    value,
    placeholder,
    mono,
    type = "text",
    onChange,
}: {
    id: string;
    text: Setting;
    hint?: string;
    value: string;
    placeholder?: string;
    mono?: boolean;
    type?: string;
    onChange: (value: string) => void;
}) {
    return (
        <SettingsRow
            id={id}
            anchor={text.anchor}
            wide
            label={text.label}
            description={hint}
            control={
                <Input
                    id={id}
                    type={type}
                    value={value}
                    placeholder={placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    className={mono ? "font-mono" : undefined}
                    onChange={(event) => onChange(event.target.value)}
                />
            }
        />
    );
}

function StorageForm({ settings }: { settings: StorageSettings }) {
    const client = useQueryClient();
    const [draft, setDraft] = useState<Draft>(() => draftOf(settings));
    useEffect(() => setDraft(draftOf(settings)), [settings]);
    const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
    const test = useMutation({
        mutationFn: () => unwrap(api.POST("/api/settings/storage/test", { body: bodyOf(draft) })),
    });
    const save = useMutation({
        mutationFn: () => unwrap(api.PUT("/api/settings/storage", { body: bodyOf(draft) })),
        onSuccess: async (saved) => {
            client.setQueryData(STORAGE_KEY, saved);
            test.reset();
            await client.invalidateQueries({ queryKey: ["infrastructure"] });
        },
    });
    const submit = (event: FormEvent) => {
        event.preventDefault();
        save.mutate();
    };
    const s3 = draft.kind === "s3";
    const locked = settings.locked;
    const formId = useId();
    const actions = !locked && (
        <>
            {s3 && (
                <Button
                    type="button"
                    variant="outline"
                    disabled={test.isPending}
                    onClick={() => test.mutate()}
                >
                    {test.isPending ? "Testing…" : "Test connection"}
                </Button>
            )}
            <Button type="submit" form={formId} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
            </Button>
        </>
    );
    return (
        <LocationSection actions={actions || undefined}>
            <div className="flex flex-col gap-field">
                <p>
                    <span className="text-muted-foreground">Now: </span>
                    <span className="font-mono break-all">{settings.location}</span>
                </p>
                <form id={formId} onSubmit={submit} className="flex flex-col gap-field">
                    {locked && (
                        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <SourceBadge source={locked} />
                            The server's settings choose where artifacts live, so they can only be
                            changed there.
                        </p>
                    )}
                    <fieldset disabled={Boolean(locked)} className="contents">
                        <RadioGroup
                            value={draft.kind}
                            onValueChange={(next) => set({ kind: next === "s3" ? "s3" : "local" })}
                            className="flex flex-col gap-3"
                        >
                            <Label className="flex items-start gap-2 font-normal">
                                <RadioGroupItem value="local" className="mt-0.5" />
                                <span className="flex flex-col">
                                    <span>Local folder</span>
                                    <span className="text-sm text-muted-foreground">
                                        Under this install's home folder, on this server's disk.
                                    </span>
                                </span>
                            </Label>
                            <Label className="flex items-start gap-2 font-normal">
                                <RadioGroupItem value="s3" className="mt-0.5" />
                                <span className="flex flex-col">
                                    <span>S3-compatible bucket</span>
                                    <span className="text-sm text-muted-foreground">
                                        AWS S3, MinIO, Ceph or any store that speaks the S3 API.
                                    </span>
                                </span>
                            </Label>
                        </RadioGroup>
                        {s3 && (
                            <SettingsGroup className="mt-0 border-t">
                                <TextField
                                    id="s3-endpoint"
                                    text={TEXT.endpoint}
                                    hint={TEXT.endpoint.description}
                                    value={draft.endpoint}
                                    placeholder="https://minio.internal:9000"
                                    mono
                                    onChange={(endpoint) => set({ endpoint })}
                                />
                                <TextField
                                    id="s3-bucket"
                                    text={TEXT.bucket}
                                    value={draft.bucket}
                                    placeholder="ml-artifacts"
                                    mono
                                    onChange={(bucket) => set({ bucket })}
                                />
                                <TextField
                                    id="s3-prefix"
                                    text={TEXT.prefix}
                                    hint={TEXT.prefix.description}
                                    value={draft.prefix}
                                    mono
                                    onChange={(prefix) => set({ prefix })}
                                />
                                <TextField
                                    id="s3-region"
                                    text={TEXT.region}
                                    hint={TEXT.region.description}
                                    value={draft.region}
                                    placeholder="us-east-1"
                                    mono
                                    onChange={(region) => set({ region })}
                                />
                                <TextField
                                    id="s3-access-key"
                                    text={TEXT.accessKey}
                                    value={draft.access_key}
                                    mono
                                    onChange={(access_key) => set({ access_key })}
                                />
                                <TextField
                                    id="s3-secret"
                                    text={TEXT.secret}
                                    type="password"
                                    hint={
                                        settings.secret_reference
                                            ? `Read from ${settings.secret_reference}.`
                                            : settings.secret_from_environment
                                              ? "Set by the MINIBRAIN_STORAGE_S3_SECRET environment variable."
                                              : TEXT.secret.description
                                    }
                                    value={draft.secret}
                                    placeholder={
                                        settings.secret_set ? "Saved; leave empty to keep it" : ""
                                    }
                                    onChange={(secret) => set({ secret })}
                                />
                            </SettingsGroup>
                        )}
                    </fieldset>
                    {test.data && (
                        <p>
                            <StatusText tone={test.data.ok ? "success" : "destructive"}>
                                {test.data.ok ? "Connected" : "Could not connect"}
                            </StatusText>
                            <span className="ml-2 text-muted-foreground">{test.data.message}</span>
                        </p>
                    )}
                    <ErrorLine error={test.error ?? save.error} />
                </form>
                <UsageLink />
            </div>
        </LocationSection>
    );
}

function UsageLink() {
    return (
        <p className="text-sm text-muted-foreground">
            {"Usage per kind is under "}
            <Link href="/infrastructure/storage" className="text-primary hover:underline">
                Infrastructure, Storage
            </Link>
            .
        </p>
    );
}

function LocationSection({ actions, children }: { actions?: ReactNode; children?: ReactNode }) {
    return (
        <SettingsSection
            icon={IconDeviceSdCard}
            anchor={STORAGE.location.anchor}
            title={STORAGE.location.title}
            description="Uploads, dataset versions, adapters, logs and base model files. New ones go to the place chosen here; ones already stored stay readable where they are."
            actions={actions}
        >
            {children}
        </SettingsSection>
    );
}

function ModelFiles({ settings }: { settings: StorageSettings }) {
    return (
        <p className="text-sm text-muted-foreground">
            {settings.kind === "s3"
                ? "Base models downloaded, imported or repaired from now on keep their files in the bucket; each machine that runs one fetches it from there and keeps a working copy. Bases already on main's disk stay there and keep working."
                : "Base model files stay on main's disk. Remote engines and workers fetch them from main."}
        </p>
    );
}

function JobLogsSection() {
    const client = useQueryClient();
    const settings = useQuery({
        queryKey: JOB_LOGS_KEY,
        queryFn: () => unwrap(api.GET("/api/settings/job-logs")),
    });
    const save = useMutation({
        mutationFn: (days: number) => unwrap(api.PUT("/api/settings/job-logs", { body: { days } })),
        onSuccess: async (saved) => {
            client.setQueryData(JOB_LOGS_KEY, saved);
            await client.invalidateQueries({ queryKey: ["infrastructure"] });
        },
    });
    const text = STORAGE.jobLogs.settings.days;
    return (
        <SettingsSection
            icon={IconFileText}
            anchor={STORAGE.jobLogs.anchor}
            title={STORAGE.jobLogs.title}
            description="Logs and training checkpoints of finished jobs on main. Queued and running jobs keep theirs, and models, adapters and datasets are never touched."
        >
            <ErrorLine error={settings.error} onRetry={settings.refetch} />
            <SettingsGroup>
                <NumberSettingRow
                    id="job-log-days-field"
                    anchor={text.anchor}
                    label={text.label}
                    description={`Default 30. ${text.description}`}
                    value={settings.data?.days}
                    format={WHOLE}
                    unit="days"
                    min={0}
                    max={3650}
                    largeStep={30}
                    pending={save.isPending}
                    error={save.error}
                    onSave={(next, saved) => save.mutate(next, { onSuccess: saved })}
                />
            </SettingsGroup>
        </SettingsSection>
    );
}

export function StorageSettingsPage() {
    const settings = useQuery({
        queryKey: STORAGE_KEY,
        queryFn: () => unwrap(api.GET("/api/settings/storage")),
    });
    return (
        <SettingsLayout
            title="Storage"
            caption="Where minibrain keeps uploads, dataset versions, adapters, logs and base model files, and how long job logs stay."
        >
            <ErrorLine error={settings.error} onRetry={settings.refetch} />
            <SettingsSections>
                {settings.data ? <StorageForm settings={settings.data} /> : <LocationSection />}
                <SettingsSection
                    icon={IconPackages}
                    anchor={STORAGE.models.anchor}
                    title={STORAGE.models.title}
                    description="Downloads, imports and repairs write base model files to the place chosen above."
                >
                    {settings.data && <ModelFiles settings={settings.data} />}
                </SettingsSection>
                <JobLogsSection />
            </SettingsSections>
        </SettingsLayout>
    );
}
