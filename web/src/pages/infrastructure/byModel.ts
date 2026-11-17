import type { components } from "~/api/schema";
import { type EngineState, type Served, worstState } from "./activity";
import { type MachineFilters, type MachineRow, matches } from "./machines";
import type { PoolInfo, ReplicaInfo } from "./parts";

export type DeployedModel = components["schemas"]["DeployedModel"];

export type ModelMachine = { row: MachineRow; engine: ReplicaInfo };

export type ModelPlace = { pool: PoolInfo; engines: ReplicaInfo[]; machines: ModelMachine[] };

export type ModelGroup = { model: DeployedModel; places: ModelPlace[] };

export type ServedHere = { served: Served; engines: ReplicaInfo[] };

export type ModelState = { label: string; tone: EngineState["tone"]; active: boolean };

export function servedOn(engines: ReplicaInfo[]): { models: ServedHere[]; bare: ReplicaInfo[] } {
    const models = new Map<string, ServedHere>();
    for (const engine of engines) {
        for (const served of engine.serves) {
            const found = models.get(served.model) ?? { served, engines: [] };
            found.engines.push(engine);
            models.set(served.model, found);
        }
    }
    return {
        models: [...models.values()],
        bare: engines.filter((engine) => engine.serves.length === 0),
    };
}

function placeOf(pool: PoolInfo, deployed: DeployedModel, rows: MachineRow[]): ModelPlace {
    const engines = pool.engines.filter((engine) => engine.base_model === deployed.base_model);
    const machines = engines.flatMap((engine) => {
        const row = rows.find(
            (item) => item.pool.name === pool.name && item.node.host === engine.host,
        );
        return row ? [{ row, engine }] : [];
    });
    return { pool, engines, machines };
}

export function modelGroups(pools: PoolInfo[], rows: MachineRow[]): ModelGroup[] {
    const groups = new Map<string, ModelGroup>();
    for (const pool of pools) {
        for (const deployed of pool.deployed ?? []) {
            const group = groups.get(deployed.model) ?? { model: deployed, places: [] };
            group.places.push(placeOf(pool, deployed, rows));
            groups.set(deployed.model, group);
        }
    }
    return [...groups.values()].sort((left, right) =>
        left.model.name.localeCompare(right.model.name),
    );
}

export function replicasOf(group: ModelGroup): ReplicaInfo[] {
    return group.places.flatMap((place) => place.engines);
}

export function modelState(group: ModelGroup): ModelState {
    const engines = replicasOf(group);
    if (engines.length === 0) {
        return { label: "No replica running", tone: "warning", active: false };
    }
    const ready = engines.filter((engine) => engine.state === "ready").length;
    if (ready === engines.length) {
        return { label: "Live", tone: "success", active: false };
    }
    const worst = worstState(engines);
    if (ready > 0) {
        return {
            label: `${ready} of ${engines.length} ready`,
            tone: worst.tone === "destructive" ? "warning" : "info",
            active: worst.active,
        };
    }
    return worst.label === "Loading" ? { ...worst, label: "Starting" } : worst;
}

export type ShownGroup = { group: ModelGroup; places: ModelPlace[] };

export function shownGroups(groups: ModelGroup[], filters: MachineFilters): ShownGroup[] {
    const text = filters.q.trim().toLowerCase();
    const machineOnly =
        filters.status.length + filters.role.length + filters.accelerator.length > 0;
    return groups.flatMap((group) => {
        const named =
            text !== "" &&
            (group.model.name.toLowerCase().includes(text) ||
                group.model.model.toLowerCase().includes(text));
        const test = named ? { ...filters, q: "" } : filters;
        const places = group.places
            .filter((place) => filters.pool.length === 0 || filters.pool.includes(place.pool.name))
            .map((place) => ({
                ...place,
                machines: place.machines.filter((machine) => matches(machine.row, test)),
            }))
            .filter(
                (place) =>
                    place.machines.length > 0 ||
                    (place.engines.length === 0 && !machineOnly && (text === "" || named)),
            );
        return places.length > 0 ? [{ group, places }] : [];
    });
}
