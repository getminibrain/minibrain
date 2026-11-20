import {
    IconActivity,
    IconAdjustmentsHorizontal,
    IconCompass,
    IconCube,
    IconCylinder,
    IconDatabase,
    IconGauge,
    IconHome,
    IconInfoCircle,
    IconKey,
    IconListCheck,
    IconPlayerPlay,
    IconPlugConnected,
    IconSchool,
    IconScript,
    IconServer,
    IconShieldCheck,
    IconTable,
    IconThumbUp,
    IconUser,
    IconUsers,
} from "@tabler/icons-react";
import type { IconComponent } from "obp-ui/shell";
import type { Role } from "~/api/authQueries";
import { allows } from "~/lib/access";

export type NavEntry = { label: string; path: string; icon: IconComponent; role?: Role };

export type NavSection = { label: string | null; items: NavEntry[] };

export const SECTIONS: NavSection[] = [
    { label: null, items: [{ label: "Home", path: "/", icon: IconHome }] },
    {
        label: "Explore",
        items: [
            { label: "Models", path: "/models", icon: IconCube },
            { label: "Discover", path: "/discover", icon: IconCompass, role: "builder" },
            { label: "Playground", path: "/playground", icon: IconPlayerPlay },
        ],
    },
    {
        label: "Create",
        items: [
            { label: "Data", path: "/data", icon: IconDatabase, role: "builder" },
            { label: "Training", path: "/training", icon: IconSchool, role: "builder" },
            { label: "Evaluations", path: "/evaluations", icon: IconGauge, role: "builder" },
            { label: "Feedback", path: "/feedback", icon: IconThumbUp, role: "builder" },
        ],
    },
    {
        label: "Operate",
        items: [
            { label: "Monitoring", path: "/monitor", icon: IconActivity },
            { label: "Jobs", path: "/jobs", icon: IconListCheck, role: "builder" },
            { label: "Infrastructure", path: "/infrastructure", icon: IconServer, role: "admin" },
            { label: "API keys", path: "/api-keys", icon: IconKey, role: "builder" },
        ],
    },
];

export const ACCOUNT_PATH = "/settings/account";

export const DOCS_URL = "https://github.com/getminibrain/minibrain/tree/main/docs";

export const SETTINGS_PAGES: NavEntry[] = [
    { label: "Your account", path: ACCOUNT_PATH, icon: IconUser },
    { label: "General", path: "/settings", icon: IconAdjustmentsHorizontal, role: "viewer" },
    { label: "Security", path: "/settings/security", icon: IconShieldCheck, role: "admin" },
    { label: "Accounts", path: "/settings/accounts", icon: IconUsers, role: "admin" },
    { label: "Audit log", path: "/settings/audit", icon: IconScript, role: "admin" },
    { label: "Data", path: "/settings/data", icon: IconTable, role: "admin" },
    { label: "Storage", path: "/settings/storage", icon: IconCylinder, role: "admin" },
    { label: "Connections", path: "/settings/connections", icon: IconPlugConnected, role: "admin" },
    { label: "This install", path: "/settings/install", icon: IconInfoCircle, role: "admin" },
];

export function visibleTo(role: Role | null | undefined): (entry: NavEntry) => boolean {
    return (entry) => !entry.role || allows(role, entry.role);
}

export function sectionsFor(role: Role | null | undefined): NavSection[] {
    const shown = visibleTo(role);
    return SECTIONS.map((section) => ({ ...section, items: section.items.filter(shown) })).filter(
        (section) => section.items.length > 0,
    );
}

export function isSettingsPath(pathname: string): boolean {
    return pathname === "/settings" || pathname.startsWith("/settings/");
}

export type NavMatch = NavEntry & { group: string | null };

const GROUPED: NavMatch[] = [
    ...SETTINGS_PAGES.map((entry) => ({ ...entry, group: "Settings" })),
    ...SECTIONS.flatMap((section) =>
        section.items.map((entry) => ({ ...entry, group: section.label })),
    ),
];

function under(pathname: string, path: string): boolean {
    return pathname === path || (path !== "/" && pathname.startsWith(`${path}/`));
}

export function navEntryFor(pathname: string): NavMatch | undefined {
    const matching = GROUPED.filter((entry) => under(pathname, entry.path));
    return matching.sort((left, right) => right.path.length - left.path.length)[0];
}
