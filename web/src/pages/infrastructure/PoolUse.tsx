import { IconDots } from "@tabler/icons-react";
import {
    Badge,
    Button,
    ConfirmDialog,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "obp-ui";
import { useState } from "react";
import { type Workload, usePoolWorkloads } from "~/api/machineQueries";
import { ErrorLine } from "~/components/Section";

type UseKey = "any" | Workload;

const USES: { key: UseKey; label: string; hint: string; workloads: Workload[] }[] = [
    { key: "any", label: "Any", hint: "Serving and training", workloads: ["serving", "training"] },
    { key: "serving", label: "Serving", hint: "Deployed models", workloads: ["serving"] },
    { key: "training", label: "Training", hint: "Training and scoring", workloads: ["training"] },
];

export function useOf(workloads: readonly string[] | undefined): UseKey {
    const serving = workloads?.includes("serving") ?? true;
    const training = workloads?.includes("training") ?? true;
    if (serving && !training) {
        return "serving";
    }
    return training && !serving ? "training" : "any";
}

export function UseBadge({ workloads }: { workloads: readonly string[] | undefined }) {
    const found = USES.find((item) => item.key === useOf(workloads));
    if (!found || found.key === "any") {
        return null;
    }
    return (
        <Badge variant="outline" className="shrink-0">
            {found.label}
        </Badge>
    );
}

function effectText(pool: string, from: UseKey, to: UseKey): string {
    if (to === "any") {
        return `New deployments can go to pool ${pool} again, and training and scoring jobs run there again.`;
    }
    if (to === "serving") {
        const jobs =
            from === "serving"
                ? ""
                : " Jobs running there now finish; queued jobs held to this pool wait until it is used for training again.";
        return `Only deployed models run on pool ${pool}: training and scoring jobs no longer start there.${jobs} Downloads, imports, checks and exports still run there.`;
    }
    const engines =
        from === "training"
            ? ""
            : " Models already deployed there keep serving until they are undeployed or moved to another pool.";
    return `Only training and scoring jobs run on pool ${pool}: new deployments no longer go there.${engines}`;
}

export function PoolMenu({
    pool,
    workloads,
}: {
    pool: string;
    workloads: readonly string[] | undefined;
}) {
    const save = usePoolWorkloads(pool);
    const current = useOf(workloads);
    const [asked, setAsked] = useState<UseKey | null>(null);
    const target = USES.find((item) => item.key === asked);
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`Actions for pool ${pool}`}>
                        <IconDots />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel>Used for</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                        value={current}
                        onValueChange={(value) => {
                            if (value !== current) {
                                setAsked(value as UseKey);
                            }
                        }}
                    >
                        {USES.map((item) => (
                            <DropdownMenuRadioItem key={item.key} value={item.key}>
                                <span>{item.label}</span>
                                <span className="ml-auto text-sm text-muted-foreground">
                                    {item.hint}
                                </span>
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
            {target && (
                <ConfirmDialog
                    open
                    onOpenChange={(open) => !open && setAsked(null)}
                    title={`Use pool ${pool} for ${target.key === "any" ? "anything" : target.label.toLowerCase()}?`}
                    description={effectText(pool, current, target.key)}
                    confirmLabel={
                        target.key === "any"
                            ? "Use for anything"
                            : `Use for ${target.label.toLowerCase()}`
                    }
                    onConfirm={() =>
                        save
                            .mutateAsync(target.workloads)
                            .then(() => setAsked(null))
                            .catch(() => undefined)
                    }
                />
            )}
            {save.error && <ErrorLine error={save.error} />}
        </>
    );
}
