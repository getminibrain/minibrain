export type DeployCandidate = {
    status: string;
    base_refusal?: string | null;
    promotion?: { passed: boolean } | null;
};

export function deployReady(version: DeployCandidate, live: boolean): boolean {
    return (
        version.status === "ready" &&
        !version.base_refusal &&
        version.promotion?.passed === true &&
        !live
    );
}
