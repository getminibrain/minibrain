import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "obp-ui";
import { useState } from "react";
import { type Workload, usePoolSettings } from "~/api/machineQueries";
import { FormControl, FormRow, FormRows } from "~/components/FormRows";
import { PickSelect } from "~/components/PickSelect";
import { ErrorLine } from "~/components/Section";

const DESCRIPTION_LIMIT = 120;

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

export function PoolDescription({ text }: { text: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="min-w-0 truncate text-sm text-muted-foreground">{text}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-normal">{text}</TooltipContent>
        </Tooltip>
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

function oneLine(text: string): string {
    return text.trim().replace(/\s+/g, " ");
}

const USE_OPTIONS = USES.map((item) => ({ value: item.key, label: item.label, meta: item.hint }));

export function PoolSettingsDialog({
    pool,
    workloads,
    description,
    onClose,
}: {
    pool: string;
    workloads: readonly string[] | undefined;
    description: string;
    onClose: () => void;
}) {
    const save = usePoolSettings(pool);
    const current = useOf(workloads);
    const [text, setText] = useState(description);
    const [picked, setPicked] = useState<UseKey>(current);
    const target = USES.find((item) => item.key === picked);
    const cleaned = oneLine(text);
    const changed = picked !== current || cleaned !== description;
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-xl">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (target && changed && !save.isPending) {
                            save.mutateAsync({ description: cleaned, workloads: target.workloads })
                                .then(onClose)
                                .catch(() => undefined);
                        }
                    }}
                    noValidate
                    className="contents"
                >
                    <DialogHeader>
                        <DialogTitle>{`Pool settings · ${pool}`}</DialogTitle>
                        <DialogDescription>
                            Say what the pool is for and which work runs on it. The pool keeps its
                            name.
                        </DialogDescription>
                    </DialogHeader>
                    <FormRows labels="narrow">
                        <FormRow id="pool-description" label="Description" align="start">
                            <FormControl width="full">
                                <Input
                                    id="pool-description"
                                    autoFocus
                                    value={text}
                                    maxLength={DESCRIPTION_LIMIT}
                                    placeholder="Production serving · H100, rack 4"
                                    onChange={(event) => setText(event.target.value)}
                                />
                                <span className="text-sm text-muted-foreground">
                                    Optional. Shown under the pool's name in pool cards and pool
                                    pickers.
                                </span>
                            </FormControl>
                        </FormRow>
                        <FormRow id="pool-use" label="Used for" align="start">
                            <FormControl width="full">
                                <PickSelect
                                    id="pool-use"
                                    value={picked}
                                    options={USE_OPTIONS}
                                    onChange={(value) =>
                                        setPicked(
                                            USES.find((item) => item.key === value)?.key ?? current,
                                        )
                                    }
                                />
                                {picked !== current && (
                                    <span className="text-sm text-muted-foreground">
                                        {effectText(pool, current, picked)}
                                    </span>
                                )}
                            </FormControl>
                        </FormRow>
                    </FormRows>
                    <ErrorLine error={save.error} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!changed || save.isPending}>
                            {save.isPending ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
