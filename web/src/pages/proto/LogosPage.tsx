import { Badge, Button, cn, getTheme, onThemeChange } from "obp-ui";
import { type ReactNode, useId, useState, useSyncExternalStore } from "react";
import { PageHeader } from "~/components/PageHeader";
import { Page, Section } from "~/components/Section";

type Mode = "light" | "dark";

type Palette = {
    brand: string;
    glyph: string;
    ink: string;
    ground: string;
};

type Colour = { id: string; name: string; light: string; dark: string; glyph?: string };

type Mark = {
    id: string;
    name: string;
    note: string;
    draw: (palette: Palette, uid: string) => ReactNode;
};

const MODES: Mode[] = ["light", "dark"];

const GROUNDS: Record<Mode, { ground: string; ink: string }> = {
    light: { ground: "#f4f5f5", ink: "#202121" },
    dark: { ground: "#010101", ink: "#e8e9ea" },
};

const COLOURS: Colour[] = [
    { id: "ink", name: "Ink", light: "#1b1c1d", dark: "#3a3d44" },
    { id: "rose", name: "Rose", light: "#f00071", dark: "#ff277c" },
    { id: "red", name: "Red", light: "#f7002a", dark: "#ff333c" },
    { id: "scarlet", name: "Scarlet", light: "#e43b00", dark: "#f84100" },
    { id: "flame", name: "Flame", light: "#cf5500", dark: "#df5c00" },
    { id: "tangerine", name: "Tangerine", light: "#bf6200", dark: "#d16b00" },
    { id: "emerald", name: "Emerald", light: "#008e40", dark: "#009a46" },
    { id: "jade", name: "Jade", light: "#008d65", dark: "#00996e" },
    { id: "teal", name: "Teal", light: "#008b7a", dark: "#009784" },
    { id: "lagoon", name: "Lagoon", light: "#008989", dark: "#009696" },
    { id: "cyan", name: "Cyan", light: "#008899", dark: "#0094a6" },
    { id: "azure", name: "Azure", light: "#0084af", dark: "#0091c0" },
    { id: "electric", name: "Electric", light: "#007ed9", dark: "#0089ea" },
    { id: "cobalt", name: "Cobalt", light: "#2971ff", dark: "#4181ff" },
    { id: "royal", name: "Royal", light: "#4f6cff", dark: "#5c7bff" },
    { id: "indigo", name: "Indigo", light: "#6d64ff", dark: "#7775ff" },
    { id: "violet", name: "Violet", light: "#8b57ff", dark: "#936aff" },
    { id: "purple", name: "Purple", light: "#ab41ff", dark: "#b158ff" },
    { id: "orchid", name: "Orchid", light: "#cd00f9", dark: "#d636ff" },
    { id: "magenta", name: "Magenta", light: "#df00c5", dark: "#f300d7" },
    { id: "pink", name: "Pink", light: "#ea0094", dark: "#fe00a2" },
    { id: "sky", name: "Sky", light: "#00ace7", dark: "#54c9ff", glyph: "#1b1c1d" },
    { id: "aqua", name: "Aqua", light: "#00becd", dark: "#00ddef", glyph: "#1b1c1d" },
    { id: "turquoise", name: "Turquoise", light: "#00c5b6", dark: "#00e5d4", glyph: "#1b1c1d" },
    { id: "volt", name: "Volt", light: "#a6d900", dark: "#bcf600", glyph: "#1b1c1d" },
];

function paletteFor(colour: Colour, mode: Mode): Palette {
    return { brand: colour[mode], glyph: colour.glyph ?? "#ffffff", ...GROUNDS[mode] };
}

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
const PRIME_TRANSFORM = "translate(32 32) scale(1.18) translate(-32 -31.6)";
const PRIME_BADGE_TRANSFORM = "translate(32 32) scale(1.06) translate(-32 -31.6)";
const PRIME_BOLT_WIDTH = 5.4;
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
        id: "26",
        name: "Prime",
        note: "Wide, perfected: the brain fills more of the tile and the bolt is cut to read at 16 px.",
        draw: (p, uid) => (
            <>
                <path d={TILE} fill={p.brand} />
                <g transform={PRIME_TRANSFORM}>
                    <SplitBrain uid={uid} fill={p.glyph} width={PRIME_BOLT_WIDTH} />
                </g>
            </>
        ),
    },
    {
        id: "27",
        name: "Prime badge",
        note: "Prime on the round badge, for avatars and anywhere that crops to a circle.",
        draw: (p, uid) => (
            <>
                <circle cx="32" cy="32" r="32" fill={p.brand} />
                <g transform={PRIME_BADGE_TRANSFORM}>
                    <SplitBrain uid={uid} fill={p.glyph} width={PRIME_BOLT_WIDTH} />
                </g>
            </>
        ),
    },
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
        note: "The brain in a circle, for places that crop to round.",
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
        name: "Classic",
        note: "The classic bolt on the squircle.",
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
    palette,
    size,
    label,
}: {
    mark: Mark;
    palette: Palette;
    size: number;
    label?: string;
}) {
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
            {mark.draw(palette, uid)}
        </svg>
    );
}

function Ground({
    mode,
    className,
    children,
}: { mode: Mode; className?: string; children: ReactNode }) {
    return (
        <div
            className={cn(
                "flex items-center justify-center rounded-md border border-border",
                className,
            )}
            style={{ background: GROUNDS[mode].ground }}
        >
            {children}
        </div>
    );
}

function MarkPreview({ mark, colour }: { mark: Mark; colour: Colour }) {
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
                    <Ground key={mode} mode={mode} className="py-8">
                        <Logo
                            mark={mark}
                            palette={paletteFor(colour, mode)}
                            size={128}
                            label={`${mark.name}, ${colour.name}, ${mode}`}
                        />
                    </Ground>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
                {MODES.map((mode) => (
                    <Ground key={mode} mode={mode} className="gap-6 py-8">
                        {PREVIEW_SIZES.map((size) => (
                            <Logo
                                key={size}
                                mark={mark}
                                palette={paletteFor(colour, mode)}
                                size={size}
                            />
                        ))}
                    </Ground>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
                {MODES.map((mode) => (
                    <Ground key={mode} mode={mode} className="py-8">
                        <span className="flex items-center gap-2.5">
                            <Logo mark={mark} palette={paletteFor(colour, mode)} size={32} />
                            <span
                                className="font-display text-2xl font-semibold tracking-tight"
                                style={{ color: GROUNDS[mode].ink }}
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

const DARK_OPTIONS = [
    {
        name: "Ink on Volt",
        tile: "#bcf600",
        glyph: "#1b1c1d",
        note: "The current logo: the ink brain reads as cut out of the badge.",
    },
    {
        name: "Volt on graphite",
        tile: "#2c2f35",
        glyph: "#bcf600",
        note: "Inverted: the brain glows Volt on a graphite badge.",
    },
    {
        name: "Volt on ink",
        tile: "#16171a",
        glyph: "#bcf600",
        note: "Inverted on a near-black badge: the brain floats, the badge almost disappears.",
    },
    {
        name: "White on Volt",
        tile: "#bcf600",
        glyph: "#ffffff",
        note: "White on bright Volt is 1.1:1: shown so you can see why it fails.",
    },
];
const DARK_SIZES = [128, 48, 32, 20, 16];

function DarkOption({ option }: { option: (typeof DARK_OPTIONS)[number] }) {
    const mark = MARKS.find((m) => m.id === STUDY_MARK) ?? MARKS[0];
    const palette: Palette = { brand: option.tile, glyph: option.glyph, ...GROUNDS.dark };
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold">{option.name}</h3>
                <p className="min-h-[2lh] text-sm text-muted-foreground">{option.note}</p>
            </div>
            <Ground mode="dark" className="gap-5 px-4 py-8">
                {DARK_SIZES.map((size) => (
                    <Logo key={size} mark={mark} palette={palette} size={size} />
                ))}
            </Ground>
            <Ground mode="dark" className="py-6">
                <span className="flex items-center gap-2.5">
                    <Logo mark={mark} palette={palette} size={28} />
                    <span
                        className="font-display text-xl font-semibold tracking-tight"
                        style={{ color: GROUNDS.dark.ink }}
                    >
                        minibrain
                    </span>
                </span>
            </Ground>
        </div>
    );
}

type BrainTile = {
    name: string;
    light: string;
    dark: string;
    glyphs: { name: string; colour: string }[];
};

const BRAIN_TILES: BrainTile[] = [
    {
        name: "Volt",
        light: "#a6d900",
        dark: "#bcf600",
        glyphs: [
            { name: "Ink", colour: "#1b1c1d" },
            { name: "Navy", colour: "#0b1f4d" },
            { name: "Plum", colour: "#3b0d3f" },
            { name: "Oxblood", colour: "#4a0d17" },
            { name: "Forest", colour: "#0f3d2e" },
            { name: "Deep blue", colour: "#123a9c" },
        ],
    },
    {
        name: "Rose",
        light: "#f00071",
        dark: "#ff277c",
        glyphs: [
            { name: "White", colour: "#ffffff" },
            { name: "Ink", colour: "#1b1c1d" },
            { name: "Cream", colour: "#fff4e0" },
            { name: "Plum", colour: "#3b0d3f" },
            { name: "Navy", colour: "#0b1f4d" },
            { name: "Oxblood", colour: "#4a0d17" },
        ],
    },
];

const BRAIN_SIZES = [32, 20, 16];
const WEAK_CONTRAST = 3;

function luminance(hex: string): number {
    const channels = [1, 3, 5].map(
        (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
    );
    const [r, g, b] = channels.map((c) =>
        c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
}

function Ratio({ mode, value }: { mode: Mode; value: number }) {
    return (
        <span className={cn("tabular-nums", value < WEAK_CONTRAST && "text-warning")}>
            {mode === "light" ? "Light" : "Dark"} {value.toFixed(1)}:1
            {value < WEAK_CONTRAST ? " low" : ""}
        </span>
    );
}

function BrainColourCard({ tile, glyph }: { tile: BrainTile; glyph: BrainTile["glyphs"][number] }) {
    const mark = MARKS.find((m) => m.id === STUDY_MARK) ?? MARKS[0];
    return (
        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
            <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                    <span
                        className="size-3.5 rounded-full border border-border"
                        style={{ background: glyph.colour }}
                    />
                    <span className="font-medium">{glyph.name}</span>
                    <span className="font-mono text-sm text-muted-foreground">{glyph.colour}</span>
                </span>
                <span className="flex gap-3 text-sm text-muted-foreground">
                    {MODES.map((mode) => (
                        <Ratio key={mode} mode={mode} value={contrast(glyph.colour, tile[mode])} />
                    ))}
                </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
                {MODES.map((mode) => {
                    const palette: Palette = {
                        brand: tile[mode],
                        glyph: glyph.colour,
                        ...GROUNDS[mode],
                    };
                    return (
                        <Ground key={mode} mode={mode} className="gap-3 px-3 py-4">
                            <Logo
                                mark={mark}
                                palette={palette}
                                size={96}
                                label={`${glyph.name} on ${tile.name}, ${mode}`}
                            />
                            <span className="flex flex-col items-center gap-2">
                                {BRAIN_SIZES.map((size) => (
                                    <Logo key={size} mark={mark} palette={palette} size={size} />
                                ))}
                            </span>
                        </Ground>
                    );
                })}
            </div>
        </div>
    );
}

const FIT_CANDIDATES = ["sky", "aqua", "turquoise", "volt"];
const FIT_MARK = "27";
const STUDY_MARK = "05";

function ThemeFit({ colour }: { colour: Colour }) {
    const mode = useSyncExternalStore(onThemeChange, getTheme);
    const mark = MARKS.find((m) => m.id === FIT_MARK) ?? MARKS[0];
    return (
        <div className="flex flex-col gap-4 rounded-md border border-border p-panel">
            <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                    <Logo mark={mark} palette={paletteFor(colour, mode)} size={32} />
                    <span className="font-display text-xl font-semibold tracking-tight">
                        minibrain
                    </span>
                </span>
                <span className="text-sm text-muted-foreground">
                    {colour.name} <span className="font-mono">{colour[mode]}</span>
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm">Deploy</Button>
                <Button size="sm" variant="outline">
                    Cancel
                </Button>
                <Badge variant="success">Live</Badge>
                <Badge variant="warning">Degraded</Badge>
                <Badge variant="destructive">Failed</Badge>
                <Badge variant="info">Queued</Badge>
                <Badge variant="approval">In review</Badge>
            </div>
        </div>
    );
}

function ColourPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
    return (
        <div className="flex flex-wrap gap-2">
            {COLOURS.map((colour) => {
                const selected = colour.id === value;
                return (
                    <button
                        key={colour.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onChange(colour.id)}
                        className={cn(
                            "flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-sm hover:bg-secondary",
                            selected
                                ? "border-primary bg-accent text-accent-foreground"
                                : "border-border",
                        )}
                    >
                        <span className="flex">
                            <span
                                className="size-3.5 rounded-l-full"
                                style={{ background: colour.light }}
                            />
                            <span
                                className="size-3.5 rounded-r-full"
                                style={{ background: colour.dark }}
                            />
                        </span>
                        {colour.name}
                    </button>
                );
            })}
        </div>
    );
}

function ColourMatrix({
    selected,
    onSelect,
}: { selected: string; onSelect: (id: string) => void }) {
    return (
        <div className="overflow-x-auto">
            <div className="grid min-w-[60rem] grid-cols-[8rem_repeat(8,minmax(0,1fr))] items-center gap-x-3 gap-y-2">
                <span />
                {MARKS.map((mark) => (
                    <span
                        key={mark.id}
                        className="truncate text-center text-sm text-muted-foreground"
                    >
                        <span className="font-mono tabular-nums">{mark.id}</span> {mark.name}
                    </span>
                ))}
                {COLOURS.map((colour) => (
                    <div key={colour.id} className="contents">
                        <button
                            type="button"
                            onClick={() => onSelect(colour.id)}
                            className={cn(
                                "flex h-full cursor-pointer flex-col items-start justify-center rounded-md px-2 text-left hover:bg-secondary",
                                colour.id === selected && "bg-accent text-accent-foreground",
                            )}
                        >
                            <span className="text-sm font-medium">{colour.name}</span>
                            <span className="font-mono text-sm text-muted-foreground">
                                {colour.light}
                            </span>
                        </button>
                        {MARKS.map((mark) => (
                            <div key={mark.id} className="grid grid-cols-2 gap-1">
                                {MODES.map((mode) => (
                                    <Ground key={mode} mode={mode} className="py-2">
                                        <Logo
                                            mark={mark}
                                            palette={paletteFor(colour, mode)}
                                            size={32}
                                        />
                                    </Ground>
                                ))}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function LogosPage() {
    const [colourId, setColourId] = useState("cobalt");
    const colour = COLOURS.find((c) => c.id === colourId) ?? COLOURS[0];
    return (
        <Page wide>
            <PageHeader
                title="Logos"
                caption="Prototype, development only. Directions for the minibrain mark."
            />
            <Section
                title="Colour"
                caption="Vivid colours at full saturation, with Ink as the reference. The white brain stays at 4.2:1 or more in light mode and 3.6:1 in dark; Sky, Aqua, Turquoise and Volt are bright tiles with an ink brain."
            >
                <ColourPicker value={colour.id} onChange={setColourId} />
            </Section>
            <Section
                title="Dark mode"
                caption="The 05 badge in Volt on a dark background, four ways."
            >
                <div className="grid grid-cols-2 gap-x-8 gap-y-10">
                    {DARK_OPTIONS.map((option) => (
                        <DarkOption key={option.name} option={option} />
                    ))}
                </div>
            </Section>
            <Section
                title="Brain colour"
                caption="Volt stays ink; here are other brain colours on Volt, and Rose as a tile, light and dark. Colours under 3:1 on the light tile are left out."
            >
                <div className="flex flex-col gap-8">
                    {BRAIN_TILES.map((tile) => (
                        <div key={tile.name} className="flex flex-col gap-3">
                            <h3 className="text-lg font-semibold">On {tile.name}</h3>
                            <div className="grid grid-cols-2 gap-4">
                                {tile.glyphs.map((glyph) => (
                                    <BrainColourCard key={glyph.name} tile={tile} glyph={glyph} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </Section>
            <Section
                title="Theme fit"
                caption="Bright tiles with an ink brain, next to the theme's own button and status colours. Switch the app between light and dark to see both."
            >
                <div className="grid grid-cols-2 gap-4">
                    {FIT_CANDIDATES.map((id) => {
                        const candidate = COLOURS.find((c) => c.id === id);
                        return candidate ? <ThemeFit key={id} colour={candidate} /> : null;
                    })}
                </div>
            </Section>
            <Section
                title="Shortlist"
                caption={`Prime, my recommendation, then your picks, in ${colour.name}.`}
            >
                <div className="grid grid-cols-3 gap-x-8 gap-y-10">
                    {MARKS.map((mark) => (
                        <MarkPreview key={mark.id} mark={mark} colour={colour} />
                    ))}
                </div>
            </Section>
            <Section
                title="Every colour"
                caption="Every colour on every mark, light and dark. Pick a row to preview it above."
            >
                <ColourMatrix selected={colour.id} onSelect={setColourId} />
            </Section>
        </Page>
    );
}
