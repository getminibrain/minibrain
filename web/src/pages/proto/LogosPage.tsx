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
    light: { brand: "#026ecd", glyph: "#feffff", ink: "#202121", ground: "#f4f5f5" },
    dark: { brand: "#346bf1", glyph: "#feffff", ink: "#e8e9ea", ground: "#010101" },
};

const ORIGINAL_LEFT =
    "M30.4 18.67A7 7 0 0 0 18.11 24.72A7.5 7.5 0 0 0 17.54 39.12A7 7 0 0 0 30.4 44.11Z";
const ORIGINAL_RIGHT =
    "M33.6 18.67A7 7 0 0 1 45.89 24.72A7.5 7.5 0 0 1 46.46 39.12A7 7 0 0 1 33.6 44.11Z";

const BRAIN = [
    "M32 18.81A7.49 7.49 0 0 0 18.12 23.35A1.7 1.7 0 0 1 17.02 25.09A7.92 7.92 0 0 0 16.83 39.85",
    "A1.7 1.7 0 0 1 17.89 41.52A7.28 7.28 0 0 0 32 44.38Z",
    "M32 18.81A7.49 7.49 0 0 1 45.88 23.35A1.7 1.7 0 0 0 46.98 25.09A7.92 7.92 0 0 1 47.17 39.85",
    "A1.7 1.7 0 0 0 46.11 41.52A7.28 7.28 0 0 1 32 44.38Z",
].join("");

const HOLLOW = [
    "M27.2 18.48A4.49 4.49 0 0 0 21.11 23.07A4.7 4.7 0 0 1 18.08 27.9A4.92 4.92 0 0 0 17.96 37.07",
    "A4.7 4.7 0 0 1 20.88 41.69A4.28 4.28 0 0 0 27.2 45.68Z",
    "M36.8 18.48A4.49 4.49 0 0 1 42.89 23.07A4.7 4.7 0 0 0 45.92 27.9A4.92 4.92 0 0 1 46.04 37.07",
    "A4.7 4.7 0 0 0 43.12 41.69A4.28 4.28 0 0 1 36.8 45.68Z",
].join("");

const ECHO = [
    "M32 13.38A11.29 11.29 0 0 0 14.3 22.16A11.72 11.72 0 0 0 14.11 42.75A11.08 11.08 0 0 0 32 50.63",
    "M32 13.38A11.29 11.29 0 0 1 49.7 22.16A11.72 11.72 0 0 1 49.89 42.75A11.08 11.08 0 0 1 32 50.63",
].join("");

const FISSURE = 3.6;
const BOLT = "M34.6 6L30.5 32.5H33.5L29.4 58";
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

function Fissure() {
    return <rect x={32 - FISSURE / 2} y="0" width={FISSURE} height="64" fill="black" />;
}

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

const BRAIN_WIDTH = 34.34;
const BRAIN_HEIGHT = 25.57;

function MiniBrain({ x, y, scale, fill }: { x: number; y: number; scale: number; fill: string }) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
    return (
        <g
            transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale}) translate(-32 -31.6)`}
        >
            <Carved uid={uid} cut={<Fissure />}>
                <path d={BRAIN} fill={fill} />
            </Carved>
        </g>
    );
}

function polar(radius: number, degrees: number, cx = 32, cy = 32): [number, number] {
    const t = (degrees * Math.PI) / 180;
    return [cx + radius * Math.cos(t), cy + radius * Math.sin(t)];
}

function rowOfSizes(scales: number[], gap: number): { x: number; y: number; scale: number }[] {
    const widths = scales.map((scale) => BRAIN_WIDTH * scale);
    const base = 32 + (BRAIN_HEIGHT * Math.max(...scales)) / 2;
    let x = 32 - (widths.reduce((sum, w) => sum + w, 0) + gap * (scales.length - 1)) / 2;
    return scales.map((scale, i) => {
        const placed = { x: x + widths[i] / 2, y: base - (BRAIN_HEIGHT * scale) / 2, scale };
        x += widths[i] + gap;
        return placed;
    });
}

const SIZES = rowOfSizes([0.27, 0.4, 0.56], 3.2);
const OCTO_NODES = Array.from({ length: 8 }, (_, i) => polar(22, i * 45 + 22.5));
const RING_BRAINS = Array.from({ length: 6 }, (_, i) => polar(16.5, i * 60 - 90));
const MOON = polar(19, -42, 30, 34);
const FLOCK = [
    { x: 32, y: 22, scale: 0.36 },
    { x: 21, y: 33, scale: 0.28 },
    { x: 43, y: 33, scale: 0.28 },
    { x: 12.5, y: 44, scale: 0.22 },
    { x: 51.5, y: 44, scale: 0.22 },
];

function Squircle({ fill }: { fill: string }) {
    return <path d={TILE} fill={fill} />;
}

const MANY: Mark[] = [
    {
        id: "06",
        name: "Quad",
        note: "Four models, one tile: a specialist for every job.",
        draw: (p) => (
            <>
                <Squircle fill={p.brand} />
                {[21.5, 42.5].flatMap((x) =>
                    [23, 41].map((y) => (
                        <MiniBrain key={`${x}-${y}`} x={x} y={y} scale={0.42} fill={p.glyph} />
                    )),
                )}
            </>
        ),
    },
    {
        id: "07",
        name: "Trio",
        note: "Three minds working together. The quietest of the set at small sizes.",
        draw: (p) => (
            <>
                <Squircle fill={p.brand} />
                <MiniBrain x={32} y={22.5} scale={0.44} fill={p.glyph} />
                <MiniBrain x={21.3} y={41.5} scale={0.44} fill={p.glyph} />
                <MiniBrain x={42.7} y={41.5} scale={0.44} fill={p.glyph} />
            </>
        ),
    },
    {
        id: "08",
        name: "Sizes",
        note: "Small, medium and large on one baseline: models of any size.",
        draw: (p) => (
            <>
                <Squircle fill={p.brand} />
                {SIZES.map((b) => (
                    <MiniBrain key={b.scale} x={b.x} y={b.y} scale={b.scale} fill={p.glyph} />
                ))}
            </>
        ),
    },
    {
        id: "09",
        name: "Split",
        note: "A small model budding off a larger one: a specialist made from a base model.",
        draw: (p) => (
            <>
                <Squircle fill={p.brand} />
                <MiniBrain x={25.5} y={34.5} scale={0.62} fill={p.glyph} />
                <circle cx="44.5" cy="22.5" r="10.6" fill={p.brand} />
                <MiniBrain x={44.5} y={22.5} scale={0.4} fill={p.glyph} />
            </>
        ),
    },
    {
        id: "10",
        name: "Fork",
        note: "One base model branching into two specialists, like a family tree of versions.",
        draw: (p) => (
            <>
                <Squircle fill={p.brand} />
                <g fill="none" stroke={p.glyph} strokeWidth="2" strokeLinecap="round">
                    <path d="M32 37.5V33C32 29.5 27 28.8 22.5 27" />
                    <path d="M32 33C32 29.5 37 28.8 41.5 27" />
                </g>
                <MiniBrain x={32} y={45} scale={0.46} fill={p.glyph} />
                <MiniBrain x={19.5} y={20.5} scale={0.34} fill={p.glyph} />
                <MiniBrain x={44.5} y={20.5} scale={0.34} fill={p.glyph} />
            </>
        ),
    },
    {
        id: "11",
        name: "Orbit",
        note: "A small model orbiting a larger one: the specialist beside the private frontier model.",
        draw: (p) => (
            <>
                <Squircle fill={p.brand} />
                <circle cx="30" cy="34" r="19" fill="none" stroke={p.glyph} strokeWidth="1.8" />
                <MiniBrain x={30} y={34} scale={0.62} fill={p.glyph} />
                <circle cx={MOON[0]} cy={MOON[1]} r="7.2" fill={p.brand} />
                <MiniBrain x={MOON[0]} y={MOON[1]} scale={0.3} fill={p.glyph} />
            </>
        ),
    },
    {
        id: "12",
        name: "Octo",
        note: "A central brain and eight nodes, like an octopus with a brain in every arm.",
        draw: (p) => (
            <>
                <Squircle fill={p.brand} />
                <MiniBrain x={32} y={32} scale={0.6} fill={p.glyph} />
                {OCTO_NODES.map(([x, y]) => (
                    <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" fill={p.glyph} />
                ))}
            </>
        ),
    },
    {
        id: "13",
        name: "Ring",
        note: "Six models in a circle: a council of specialists with no single centre.",
        draw: (p) => (
            <>
                <Squircle fill={p.brand} />
                {RING_BRAINS.map(([x, y]) => (
                    <MiniBrain key={`${x}-${y}`} x={x} y={y} scale={0.27} fill={p.glyph} />
                ))}
            </>
        ),
    },
    {
        id: "14",
        name: "Flock",
        note: "Five models flying in formation: coordinated, each with its own job.",
        draw: (p) => (
            <>
                <Squircle fill={p.brand} />
                {FLOCK.map((b) => (
                    <MiniBrain
                        key={`${b.x}-${b.y}`}
                        x={b.x}
                        y={b.y}
                        scale={b.scale}
                        fill={p.glyph}
                    />
                ))}
            </>
        ),
    },
    {
        id: "15",
        name: "Deck",
        note: "Stacked tiles, one model on top: many models, one install.",
        draw: (p) => (
            <>
                {[
                    [6.5, -6.5],
                    [2, -2],
                    [-2.5, 2.5],
                ].map(([dx, dy]) => (
                    <g
                        key={`${dx}`}
                        transform={`translate(${dx} ${dy}) translate(32 32) scale(.7) translate(-32 -32)`}
                    >
                        <path d={TILE} fill={p.brand} stroke={p.ground} strokeWidth="2.8" />
                    </g>
                ))}
                <MiniBrain x={29.5} y={34.5} scale={0.46} fill={p.glyph} />
            </>
        ),
    },
];

const STRIKE = "M33.6 6L30.9 33H33.1L30.4 58";
const ZIGZAG = "M35.4 6L31.4 23.5H34.4L29.6 40.5H32.6L28.6 58";
const OFFSET_BOLT = "M39 6L30.6 31.5H34.4L25 58";
const LONG_BOLT = "M35.6 2L30.5 32.5H33.5L28.4 62";
const AMBER = "#fbbf24";
const INK = "#1b1c1d";
const HAIRLINE = "#d3d4d5";

function BoltCut({ d = BOLT, width = FISSURE }: { d?: string; width?: number }) {
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

const BOLTS: Mark[] = [
    {
        id: "16",
        name: "Strike",
        note: "A steeper, narrower bolt: the split reads first as a fissure, then as lightning.",
        draw: (p, uid) => (
            <>
                <Squircle fill={p.brand} />
                <SplitBrain uid={uid} fill={p.glyph} d={STRIKE} />
            </>
        ),
    },
    {
        id: "17",
        name: "Zigzag",
        note: "Two kinks instead of one: more electric, still one clean cut.",
        draw: (p, uid) => (
            <>
                <Squircle fill={p.brand} />
                <SplitBrain uid={uid} fill={p.glyph} d={ZIGZAG} width={3.4} />
            </>
        ),
    },
    {
        id: "18",
        name: "Wide",
        note: "A heavier bolt that stays legible at favicon size.",
        draw: (p, uid) => (
            <>
                <Squircle fill={p.brand} />
                <SplitBrain uid={uid} fill={p.glyph} width={5.2} />
            </>
        ),
    },
    {
        id: "19",
        name: "Fine",
        note: "A hairline bolt: the quietest, best large and in print.",
        draw: (p, uid) => (
            <>
                <Squircle fill={p.brand} />
                <SplitBrain uid={uid} fill={p.glyph} width={2.4} />
            </>
        ),
    },
    {
        id: "20",
        name: "Offset",
        note: "A diagonal strike that splits the halves unevenly: motion, a thought arriving.",
        draw: (p, uid) => (
            <>
                <Squircle fill={p.brand} />
                <SplitBrain uid={uid} fill={p.glyph} d={OFFSET_BOLT} />
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
                <g transform="translate(32 32) scale(0.92) translate(-32 -31.6)">
                    <SplitBrain uid={uid} fill={p.glyph} />
                </g>
            </>
        ),
    },
    {
        id: "22",
        name: "Echo bolt",
        note: "The Echo brain on the badge, with the bolt cutting through the ring as well.",
        draw: (p, uid) => (
            <>
                <circle cx="32" cy="32" r="32" fill={p.brand} />
                <Carved uid={uid} cut={<BoltCut d={LONG_BOLT} />}>
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
        id: "23",
        name: "Amber",
        note: "The split glows: an amber bolt inside the cut, clipped to the brain.",
        draw: (p, uid) => (
            <>
                <Squircle fill={p.brand} />
                <SplitBrain uid={uid} fill={p.glyph} width={4.6} />
                <defs>
                    <clipPath id={`amber-${uid}`}>
                        <path d={BRAIN} />
                    </clipPath>
                </defs>
                <path
                    d={BOLT}
                    fill="none"
                    stroke={AMBER}
                    strokeWidth="1.8"
                    strokeLinejoin="miter"
                    strokeMiterlimit="12"
                    clipPath={`url(#amber-${uid})`}
                />
            </>
        ),
    },
    {
        id: "24",
        name: "Ink",
        note: "Near-black tile, white brain: the most serious, for print and enterprise decks.",
        draw: (p, uid) => (
            <>
                <Squircle fill={INK} />
                <SplitBrain uid={uid} fill={p.glyph} />
            </>
        ),
    },
    {
        id: "25",
        name: "Inverse",
        note: "White tile, cobalt brain: for dark backgrounds and light, airy pages.",
        draw: (p, uid) => (
            <>
                <path d={TILE} fill={p.glyph} stroke={HAIRLINE} strokeWidth="1" />
                <SplitBrain uid={uid} fill={p.brand} />
            </>
        ),
    },
];

const MARKS: Mark[] = [
    {
        id: "00",
        name: "Cortex",
        note: "The one you picked: two hemispheres cut from a cobalt tile.",
        draw: (p) => (
            <>
                <rect width="64" height="64" rx="16" fill={p.brand} />
                <path d={ORIGINAL_LEFT} fill={p.glyph} />
                <path d={ORIGINAL_RIGHT} fill={p.glyph} />
            </>
        ),
    },
    {
        id: "01",
        name: "Cortex, refined",
        note: "The same idea, drawn properly: a squircle tile, smooth folds between the lobes and a fissure that holds at 16 px.",
        draw: (p, uid) => (
            <>
                <path d={TILE} fill={p.brand} />
                <Carved uid={uid} cut={<Fissure />}>
                    <path d={BRAIN} fill={p.glyph} />
                </Carved>
            </>
        ),
    },
    {
        id: "02",
        name: "Bolt",
        note: "The fissure becomes a lightning bolt: brain power, without adding anything to the shape.",
        draw: (p, uid) => (
            <>
                <path d={TILE} fill={p.brand} />
                <Carved
                    uid={uid}
                    cut={
                        <path
                            d={BOLT}
                            fill="none"
                            stroke="black"
                            strokeWidth={FISSURE}
                            strokeLinejoin="miter"
                            strokeMiterlimit="12"
                        />
                    }
                >
                    <path d={BRAIN} fill={p.glyph} />
                </Carved>
            </>
        ),
    },
    {
        id: "03",
        name: "Hollow",
        note: "The brain as one even line, the width of the fissure. Lighter, and it still reads small.",
        draw: (p, uid) => (
            <>
                <path d={TILE} fill={p.brand} />
                <Carved
                    uid={uid}
                    cut={
                        <>
                            <Fissure />
                            <path d={HOLLOW} fill="black" />
                        </>
                    }
                >
                    <path d={BRAIN} fill={p.glyph} />
                </Carved>
            </>
        ),
    },
    {
        id: "04",
        name: "Echo",
        note: "A second outline around the brain, like a pulse: a mind at work, or a model wrapped around it.",
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
        note: "Refined Cortex in a circle, for places that crop to round: GitHub, social avatars, app badges.",
        draw: (p, uid) => (
            <>
                <circle cx="32" cy="32" r="32" fill={p.brand} />
                <g transform="translate(32 32) scale(0.92) translate(-32 -31.6)">
                    <Carved uid={uid} cut={<Fissure />}>
                        <path d={BRAIN} fill={p.glyph} />
                    </Carved>
                </g>
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
            <Ground mode="light">
                <span className="flex items-center gap-3">
                    <Logo mark={mark} mode="light" size={36} />
                    <span
                        className="font-display text-3xl font-semibold tracking-tight"
                        style={{ color: PALETTES.light.ink }}
                    >
                        minibrain
                    </span>
                </span>
            </Ground>
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
            <Section title="Cortex" caption="The mark you picked, and five refinements of it.">
                <div className="grid grid-cols-3 gap-x-8 gap-y-10">
                    {MARKS.map((mark) => (
                        <MarkPreview key={mark.id} mark={mark} />
                    ))}
                </div>
            </Section>
            <Section
                title="Many minds"
                caption="A model for every job: many specialists, one centre, like an octopus with a brain in every arm."
            >
                <div className="grid grid-cols-3 gap-x-8 gap-y-10">
                    {MANY.map((mark) => (
                        <MarkPreview key={mark.id} mark={mark} />
                    ))}
                </div>
            </Section>
            <Section
                title="Bolt"
                caption="Brains split by a lightning bolt: power, carved into the shape itself."
            >
                <div className="grid grid-cols-3 gap-x-8 gap-y-10">
                    {BOLTS.map((mark) => (
                        <MarkPreview key={mark.id} mark={mark} />
                    ))}
                </div>
            </Section>
        </Page>
    );
}
