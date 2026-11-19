import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Cleanup, NO_CLEANUP, cleanedSql } from "../src/pages/data/cleanup.ts";

type Fixture = {
    sql: string;
    chars_per_token: number;
    cases: { cleanup: Partial<Cleanup>; sha256: string }[];
};

const path = new URL("../../tests/fixtures/cleanup_sql.json", import.meta.url);
const fixture: Fixture = JSON.parse(readFileSync(path, "utf8"));

const different = fixture.cases.filter(({ cleanup, sha256 }) => {
    const sql = cleanedSql(fixture.sql, { ...NO_CLEANUP, ...cleanup }, fixture.chars_per_token);
    return createHash("sha256").update(sql).digest("hex") !== sha256;
});

for (const { cleanup } of different.slice(0, 5)) {
    console.error(`cleanup.ts differs from cleanup.py for ${JSON.stringify(cleanup)}`);
}
console.log(`${fixture.cases.length - different.length} of ${fixture.cases.length} match`);
process.exit(different.length === 0 ? 0 : 1);
