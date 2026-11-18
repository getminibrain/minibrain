import type { ErrorDetail } from "obp-ui";
import { ApiError } from "~/api/client";

export function errorDetails(error: unknown): ErrorDetail[] {
    if (!(error instanceof ApiError)) {
        return [];
    }
    const details: ErrorDetail[] = [
        { label: "Status", value: error.status === null ? "No connection" : String(error.status) },
    ];
    if (error.path) {
        details.push({ label: "Path", value: error.path });
    }
    if (error.requestId) {
        details.push({ label: "Request ID", value: error.requestId });
    }
    return details;
}
