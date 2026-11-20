import { type ReactNode, useId } from "react";
import { PageHeader } from "~/components/PageHeader";
import { Page, Section } from "~/components/Section";

type Mode = "light" | "dark";

type Palette = {
    brand: string;
    glyph: string;
    ink: string;
    ground: string;
};

type Mark = {
    id: string;
    name: string;
    note: string;
    draw: (palette: Palette, uid: string) => ReactNode;
};

const MODES: Mode[] = ["light", "dark"];

const PALETTES: Record<Mode, Palette> = {
    light: { brand: "#1b1c1d", glyph: "#feffff", ink: "#202121", ground: "#f4f5f5" },
    dark: { brand: "#1b1c1d", glyph: "#feffff", ink: "#e8e9ea", ground: "#010101" },
};

const BRAIN = [
    "M32 18.81A7.49 7.49 0 0 0 18.12 23.35A1.7 1.7 0 0 1 17.02 25.09A7.92 7.92 0 0 0 16.83 39.85",
    "A1.7 1.7 0 0 1 17.89 41.52A7.28 7.28 0 0 0 32 44.38Z",
    "M32 18.81A7.49 7.49 0 0 1 45.88 23.35A1.7 1.7 0 0 0 46.98 25.09A7.92 7.92 0 0 1 47.17 39.85",
    "A1.7 1.7 0 0 0 46.11 41.52A7.28 7.28 0 0 1 32 44.38Z",
].join("");

const ECHO = [
    "M32 13.38A11.29 11.29 0 0 0 14.3 22.16A11.72 11.72 0 0 0 14.11 42.75A11.08 11.08 0 0 0 32 50.63",
    "M32 13.38A11.29 11.29 0 0 1 49.7 22.16A11.72 11.72 0 0 1 49.89 42.75A11.08 11.08 0 0 1 32 50.63",
].join("");

const FISSURE = 3.6;
const BOLT = "M36.8 6L29.2 32.5H34.8L27.2 58";
const STRIKE = "M35 6L29.9 33H34.1L29 58";
const BOLT_WIDTH = 4.8;
const BADGE_TRANSFORM = "translate(32 32) scale(0.92) translate(-32 -31.6)";
const PREVIEW_SIZES = [48, 32, 16];

function squircle(n = 5, steps = 144): string {
    const points = Array.from({ length: steps }, (_, i) => {
        const t = (2 * Math.PI * i) / steps;
        const along = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / n);
        return `${(32 + 32 * along(Math.cos(t))).toFixed(2)} ${(32 + 32 * along(Math.sin(t))).toFixed(2)}`;
    });
    return `M${points.join("L")}Z`;
}

const TILE = squircle();

function Carved({ uid, cut, children }: { uid: string; cut: ReactNode; children: ReactNode }) {
    const id = `carve-${uid}`;
    return (
        <>
            <defs>
                <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
                    <rect width="64" height="64" fill="white" />
                    {cut}
                </mask>
            </defs>
            <g mask={`url(#${id})`}>{children}</g>
        </>
    );
}

function Fissure() {
    return <rect x={32 - FISSURE / 2} y="0" width={FISSURE} height="64" fill="black" />;
}

function BoltCut({ d = BOLT, width = BOLT_WIDTH }: { d?: string; width?: number }) {
    return (
        <path
            d={d}
            fill="none"
            stroke="black"
            strokeWidth={width}
            strokeLinejoin="miter"
            strokeMiterlimit="12"
        />
    );
}

function SplitBrain({
    uid,
    fill,
    d,
    width,
}: { uid: string; fill: string; d?: string; width?: number }) {
    return (
        <Carved uid={uid} cut={<BoltCut d={d} width={width} />}>
            <path d={BRAIN} fill={fill} />
        </Carved>
    );
}

const MARKS: Mark[] = [
    {
        id: "04",
        name: "Echo",
        note: "A second outline around the brain, like a pulse: a mind at work.",
        draw: (p, uid) => (
            <>
                <path d={TILE} fill={p.brand} />
                <Carved uid={uid} cut={<Fissure />}>
                    <path d={BRAIN} fill={p.glyph} />
                    <path
                        d={ECHO}
                        fill="none"
                        stroke={p.glyph}
                        strokeWidth="2"
                        strokeLinejoin="round"
                    />
                </Carved>
            </>
        ),
    },
    {
        id: "05",
        name: "Badge",
        note: "The brain in a circle, for places that crop to round: GitHub, social avatars, app badges.",
        draw: (p, uid) => (
            <>
                <circle cx="32" cy="32" r="32" fill={p.brand} />
                <g transform={BADGE_TRANSFORM}>
                    <Carved uid={uid} cut={<Fissure />}>
                        <path d={BRAIN} fill={p.glyph} />
                    </Carved>
                </g>
            </>
        ),
    },
    {
        id: "16",
        name: "Strike",
        note: "A steeper, narrower bolt: the split reads first as a fissure, then as lightning.",
        draw: (p, uid) => (
            <>
                <path d={TILE} fill={p.brand} />
                <SplitBrain uid={uid} fill={p.glyph} d={STRIKE} />
            </>
        ),
    },
    {
        id: "18",
        name: "Wide",
        note: "The heaviest bolt: the clearest at favicon size.",
        draw: (p, uid) => (
            <>
                <path d={TILE} fill={p.brand} />
                <SplitBrain uid={uid} fill={p.glyph} width={6} />
            </>
        ),
    },
    {
        id: "21",
        name: "Bolt badge",
        note: "The bolt-split brain on the round badge.",
        draw: (p, uid) => (
            <>
                <circle cx="32" cy="32" r="32" fill={p.brand} />
                <g transform={BADGE_TRANSFORM}>
                    <SplitBrain uid={uid} fill={p.glyph} />
                </g>
            </>
        ),
    },
    {
        id: "24",
        name: "Ink",
        note: "The classic bolt on the ink squircle.",
        draw: (p, uid) => (
            <>
                <path d={TILE} fill={p.brand} />
                <SplitBrain uid={uid} fill={p.glyph} />
            </>
        ),
    },
];

function Logo({
    mark,
    mode,
    size,
    label,
}: { mark: Mark; mode: Mode; size: number; label?: string }) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
    return (
        <svg
            viewBox="0 0 64 64"
            width={size}
            height={size}
            role={label ? "img" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        >
            {mark.draw(PALETTES[mode], uid)}
        </svg>
    );
}

function Ground({ mode, children }: { mode: Mode; children: ReactNode }) {
    return (
        <div
            className="flex items-center justify-center gap-6 rounded-md border border-border py-8"
            style={{ background: PALETTES[mode].ground }}
        >
            {children}
        </div>
    );
}

function MarkPreview({ mark }: { mark: Mark }) {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-3">
                    <span className="font-mono text-sm text-muted-foreground tabular-nums">
                        {mark.id}
                    </span>
                    <h3 className="text-lg font-semibold">{mark.name}</h3>
                </div>
                <p className="min-h-[2lh] text-sm text-muted-foreground">{mark.note}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
                {MODES.map((mode) => (
                    <Ground key={mode} mode={mode}>
                        <Logo mark={mark} mode={mode} size={128} label={`${mark.name}, ${mode}`} />
                    </Ground>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
                {MODES.map((mode) => (
                    <Ground key={mode} mode={mode}>
                        {PREVIEW_SIZES.map((size) => (
                            <Logo key={size} mark={mark} mode={mode} size={size} />
                        ))}
                    </Ground>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
                {MODES.map((mode) => (
                    <Ground key={mode} mode={mode}>
                        <span className="flex items-center gap-2.5">
                            <Logo mark={mark} mode={mode} size={32} />
                            <span
                                className="font-display text-2xl font-semibold tracking-tight"
                                style={{ color: PALETTES[mode].ink }}
                            >
                                minibrain
                            </span>
                        </span>
                    </Ground>
                ))}
            </div>
        </div>
    );
}

export function LogosPage() {
    return (
        <Page wide>
            <PageHeader
                title="Logos"
                caption="Prototype, development only. Directions for the minibrain mark."
            />
            <Section title="Shortlist" caption="Your six picks, in ink.">
                <div className="grid grid-cols-3 gap-x-8 gap-y-10">
                    {MARKS.map((mark) => (
                        <MarkPreview key={mark.id} mark={mark} />
                    ))}
                </div>
            </Section>
        </Page>
    );
}
