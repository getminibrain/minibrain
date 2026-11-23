import { IconArrowRight, IconListCheck } from "@tabler/icons-react";
import { Button, Link } from "obp-ui";
import type { JobInfo } from "~/api/client";
import { isActiveJob } from "~/api/queries";
import { SectionError } from "~/components/ErrorState";
import { ModelName } from "~/components/ModelName";
import { PanelSection } from "~/components/Section";
import { JobStatus } from "~/components/StatusBadge";
import { When } from "~/components/When";
import { useCan } from "~/lib/access";
import { percent } from "~/lib/format";
import { jobTitle } from "~/lib/jobs";
import { JOBS_PATH, jobHref } from "~/lib/modelLinks";
import type { HomeData } from "./data";

function modelOf(job: JobInfo): string {
    return job.model_name ?? job.base_model_name ?? job.base_model ?? "Install";
}

function whenOf(job: JobInfo): string {
    return job.finished_at ?? job.started_at ?? job.created_at;
}

function ordered(jobs: JobInfo[]): JobInfo[] {
    return [...jobs.filter(isActiveJob), ...jobs.filter((job) => !isActiveJob(job))];
}

function JobLine({ job }: { job: JobInfo }) {
    return (
        <li className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex min-w-0 flex-col">
                <Link href={jobHref(job)} className="truncate text-foreground hover:underline">
                    <ModelName name={modelOf(job)} deleted={job.deleted} />
                </Link>
                <span className="truncate text-sm text-muted-foreground">
                    {jobTitle(job)}
                    {" · "}
                    <When value={whenOf(job)} />
                </span>
            </span>
            <span className="flex items-center gap-2">
                <JobStatus job={job} />
                {job.status === "running" && (
                    <span className="text-sm text-muted-foreground tabular-nums">
                        {percent(job.progress)}
                    </span>
                )}
            </span>
        </li>
    );
}

function Body({ data }: { data: HomeData }) {
    if (data.jobs.error) {
        return <SectionError error={data.jobs.error} retry={data.jobs.refetch} />;
    }
    const jobs = ordered(data.jobs.data ?? []);
    if (jobs.length === 0) {
        return (
            <p className="px-4 py-3 text-muted-foreground">
                {data.jobs.isLoading ? "Loading…" : "No jobs yet."}
            </p>
        );
    }
    return (
        <ul className="divide-y">
            {jobs.map((job) => (
                <JobLine key={job.id} job={job} />
            ))}
        </ul>
    );
}

export function JobsPanel({ data }: { data: HomeData }) {
    const can = useCan();
    return (
        <PanelSection
            flush
            icon={IconListCheck}
            title="Jobs"
            description="Running first, then the latest."
            actions={
                can.build && (
                    <Button asChild variant="ghost">
                        <Link href={JOBS_PATH}>
                            All jobs
                            <IconArrowRight aria-hidden="true" />
                        </Link>
                    </Button>
                )
            }
        >
            <Body data={data} />
        </PanelSection>
    );
}
