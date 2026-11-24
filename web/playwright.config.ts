import { createServer } from "node:net";
import { defineConfig, devices } from "@playwright/test";
import { REPO_ROOT, STATE_DIR, WEB_DIST } from "./e2e/install";

const PORT_ENV = "MINIBRAIN_E2E_PORT";

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() =>
                typeof address === "object" && address
                    ? resolve(address.port)
                    : reject(new Error("no free port")),
            );
        });
    });
}

process.env[PORT_ENV] ??= String(await freePort());
const baseURL = `http://127.0.0.1:${process.env[PORT_ENV]}`;
const build = `pnpm --dir web exec vite build --outDir "${WEB_DIST}" --emptyOutDir --logLevel error`;
const serve = `uv run python scripts/e2e_server.py --port ${process.env[PORT_ENV]} --state "${STATE_DIR}" --web-dist "${WEB_DIST}"`;

export default defineConfig({
    testDir: "e2e",
    timeout: 120_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: Boolean(process.env.CI),
    reporter: "list",
    use: {
        baseURL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
        },
    ],
    webServer: {
        command: `${build} && ${serve}`,
        cwd: REPO_ROOT,
        url: `${baseURL}/readyz`,
        timeout: 300_000,
        reuseExistingServer: false,
        stdout: "pipe",
        stderr: "pipe",
    },
});
