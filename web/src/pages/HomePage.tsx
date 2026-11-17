import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid, Link } from "obp-ui";
import type { JobInfo } from "~/api/client";
import { useModels, useRecentJobs } from "~/api/queries";
import { ModelName } from "~/components/ModelName";
import { NeedsAttention } from "~/components/NeedsAttention";
import { PageHeader } from "~/components/PageHeader";
import { Page, Section, Stat } from "~/components/Section";
import { JobStatus, jobStatusRank } from "~/components/StatusBadge";
import { useCan } from "~/lib/access";
import { count, dateTime, percent } from "~/lib/format";
import { jobTitle } from "~/lib/jobs";
import { jobHref } from "~/lib/modelLinks";
import { Checklist } from "./home/Checklist";

function jobModelName(job: JobInfo): string {
    return job.model_name ?? job.base_model_name ?? job.base_model ?? "Install";
}

const JOB_COLUMNS: ColumnDef<JobInfo, unknown>[] = [
    {
        header: "Model",
        id: "model",
        accessorFn: (job) => jobModelName(job).toLowerCase(),
        cell: ({ row }) => (
            <Link className="text-primary" href={jobHref(row.original)}>
                <ModelName name={jobModelName(row.original)} deleted={row.original.deleted} />
            </Link>
        ),
    },
    {
        header: "Job",
        id: "job",
        accessorFn: (job) => jobTitle(job).toLowerCase(),
        cell: ({ row }) => jobTitle(row.original),
    },
    {
        header: "Status",
        id: "status",
        accessorFn: (job) => jobStatusRank(job.status),
        cell: ({ row }) => <JobStatus job={row.original} />,
    },
    {
        header: "Progress",
        id: "progress",
        accessorFn: (job) => job.progress,
        cell: ({ row }) => percent(row.original.progress),
    },
    {
        header: "Created",
        id: "created",
        accessorFn: (job) => Date.parse(job.created_at),
        cell: ({ row }) => dateTime(row.original.created_at),
    },
];

export function HomePage() {
    const can = useCan();
    const { data: models } = useModels();
    const { data: jobs } = useRecentJobs(10);
    const serving = (models ?? []).filter((item) => item.current_version !== null).length;
    const running = (models ?? []).reduce((total, item) => total + item.active_jobs, 0);
    return (
        <Page>
            <PageHeader
                title="Home"
                caption="Models of any size, trained on your data and served on an OpenAI-compatible endpoint. Everything runs on your own hardware."
            />
            {can.build && models && <Checklist models={models} />}
            <NeedsAttention compact />
            <Section title="Overview">
                <div className="flex flex-wrap gap-8">
                    <Stat label="Models" value={count(models?.length)} />
                    <Stat label="Serving" value={count(serving)} />
                    <Stat label="Jobs running" value={count(running)} />
                </div>
            </Section>
            <Section title="Recent jobs" flush>
                <DataGrid columns={JOB_COLUMNS} rows={jobs ?? []} empty="No jobs yet." />
            </Section>
        </Page>
    );
}
