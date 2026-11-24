import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const STATE_DIR = fileURLToPath(new URL("../.e2e", import.meta.url));
export const WEB_DIST = `${STATE_DIR}/dist`;

export function setupLink(): string {
    return readFileSync(`${STATE_DIR}/setup-link`, "utf8").trim();
}
