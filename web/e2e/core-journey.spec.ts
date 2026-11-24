import { type Page, expect, test } from "@playwright/test";
import { setupLink } from "./install";

const ADMIN = { email: "admin@example.com", password: "correct horse battery staple" };
const MODEL = { name: "Travel desk", api: "travel-desk" };
const DATASET = "demo travel intents";
const BASE = "Qwen3 0.6B";
const STEPS = ["Data", "Models", "Trained", "Evaluated", "Live", "Connected", "Requests"];

function journeyStrip(page: Page) {
    return page.getByRole("main").locator("section", {
        has: page.getByRole("heading", { name: "From data to an app" }),
    });
}

test("core journey on a fresh install: data, model, train, deploy, key, call", async ({
    page,
    request,
}) => {
    await test.step("create the admin account from the setup link", async () => {
        await page.goto(setupLink());
        await page.getByLabel("Email").fill(ADMIN.email);
        await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
        await page.getByLabel("Password again").fill(ADMIN.password);
        await page.getByRole("button", { name: "Create admin account" }).click();
        await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
        await expect(journeyStrip(page)).toContainText("0 of 7 steps have run on this install.");
    });

    await test.step("add the demo data as a dataset", async () => {
        await page.getByRole("link", { name: "Data", exact: true }).click();
        await page.getByRole("button", { name: "Add", exact: true }).click();
        await page.getByRole("menuitem", { name: /Demo travel intents/ }).click();
        await page.getByRole("button", { name: "Create dataset" }).click();
        const details = page.getByRole("region", { name: "Details" });
        await expect(details.getByRole("heading", { name: DATASET })).toBeVisible();
        await expect(details.getByRole("button", { name: /^Version 1/ })).toBeVisible();
    });

    await test.step("add a model: base, dataset and name; v0 is scored", async () => {
        await page.goto("/");
        await journeyStrip(page).getByRole("link", { name: "Add model" }).click();
        await page.getByRole("button", { name: "Base" }).click();
        await page.getByRole("combobox", { name: "Search base models" }).fill(BASE);
        await page.getByRole("option", { name: new RegExp(`^${BASE}`) }).click();
        await page.getByRole("combobox", { name: "Dataset" }).click();
        await page.getByRole("option", { name: new RegExp(`^${DATASET}`) }).click();
        await page.getByRole("textbox", { name: "Name", exact: true }).fill(MODEL.name);
        await page.getByRole("checkbox", { name: /I accept/ }).check();
        await page.getByRole("button", { name: "Create model" }).click();
        await expect(page.getByRole("heading", { name: MODEL.name, level: 1 })).toBeVisible();
        await expect(page.getByRole("link", { name: "Classify · 5 labels" })).toBeVisible();
        const baseline = page
            .getByRole("listitem")
            .filter({ has: page.getByRole("link", { name: "v0 · Baseline" }) });
        await expect(baseline).toContainText(/\d+(\.\d)?%/, { timeout: 60_000 });
    });

    await test.step("train v1; it is scored against v0", async () => {
        await page.getByRole("button", { name: "Train", exact: true }).click();
        await page.getByRole("button", { name: "Train v1" }).click();
        await expect(page).toHaveURL(new RegExp(`/models/${MODEL.api}/versions/1$`));
        await expect(page.getByRole("main")).toContainText(/\+\d+(\.\d)? vs baseline/, {
            timeout: 60_000,
        });
    });

    await test.step("deploy v1", async () => {
        await page.getByRole("button", { name: "Deploy v1" }).click();
        const dialog = page.getByRole("dialog", { name: "Deploy v1?" });
        await dialog.getByRole("button", { name: "Deploy v1" }).click();
        await expect(dialog).toBeHidden();
        await page.getByRole("navigation", { name: "Breadcrumb" }).getByText(MODEL.name).click();
        await expect(page.getByRole("main")).toContainText("Deployed · v1");
    });

    let key = "";
    await test.step("create an API key on the model's API keys tab", async () => {
        const tabs = page.getByRole("navigation", { name: `${MODEL.name} pages` });
        await tabs.getByRole("link", { name: "API keys" }).click();
        await page.getByRole("main").getByRole("button", { name: "Create key" }).first().click();
        const form = page.getByRole("dialog", { name: "Create key" });
        await form.getByRole("textbox", { name: "Name" }).fill("travel-app");
        await form.getByRole("button", { name: "Create key" }).click();
        const shown = page.getByRole("dialog", { name: "Copy your key now" });
        key = (await shown.getByText(/^mb_\S+$/).textContent()) ?? "";
        expect(key).toMatch(/^mb_/);
        await shown.getByRole("button", { name: "Done" }).click();
    });

    await test.step("call /v1/chat/completions with the key once the gateway has it", async () => {
        const call = () =>
            request.post("/v1/chat/completions", {
                headers: { Authorization: `Bearer ${key}` },
                data: {
                    model: MODEL.api,
                    messages: [{ role: "user", content: "my luggage did not arrive" }],
                },
            });
        await expect.poll(async () => (await call()).status(), { timeout: 10_000 }).toBe(200);
        const response = await call();
        expect(response.status()).toBe(200);
        const reply = await response.json();
        expect(reply.model).toBe(MODEL.api);
        expect(reply.choices[0].message.content).toBe("lost_luggage");
    });

    await test.step("Home shows every step of the journey done", async () => {
        await expect(async () => {
            await page.goto("/");
            await expect(journeyStrip(page)).toContainText("Every step has run.", {
                timeout: 2_000,
            });
        }).toPass({ timeout: 30_000 });
        const strip = journeyStrip(page);
        for (const step of STEPS) {
            await expect(strip.getByRole("listitem").filter({ hasText: step })).toContainText(
                `${step}, done`,
            );
        }
    });
});
