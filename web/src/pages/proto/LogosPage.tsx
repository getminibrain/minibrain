import { type ReactNode, useId } from "react";
import { PageHeader } from "~/components/PageHeader";
import { Page, Section } from "~/components/Section";

type Mode = "light" | "dark";

type Palette = {
    brand: string;
    glyph: string;
    tint: string;
    ink: string;
    spark: string;
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
    light: {
        brand: "#026ecd",
        glyph: "#feffff",
        tint: "#a9cdf2",
        ink: "#202121",
        spark: "#f59e0b",
        ground: "#f4f5f5",
    },
    dark: {
        brand: "#346bf1",
        glyph: "#feffff",
        tint: "#b3c8ff",
        ink: "#e8e9ea",
        spark: "#fbbf24",
        ground: "#010101",
    },
};

const LEFT_HALF =
    "M30.4 18.67A7 7 0 0 0 18.11 24.72A7.5 7.5 0 0 0 17.54 39.12A7 7 0 0 0 30.4 44.11Z";
const RIGHT_HALF =
    "M33.6 18.67A7 7 0 0 1 45.89 24.72A7.5 7.5 0 0 1 46.46 39.12A7 7 0 0 1 33.6 44.11Z";
const BOLT = "M37 2L24.5 17H32L28.5 27L41.5 12H34Z";
const BREAKOUT_BOLT = "M40 1L29 15H35.5L32.5 25L44 11H37.5Z";
const PREVIEW_SIZES = [48, 32, 16];

function star(cx: number, cy: number, r: number): string {
    const k = r * 0.16;
    return [
        `M${cx} ${cy - r}`,
        `Q${cx + k} ${cy - k} ${cx + r} ${cy}`,
        `Q${cx + k} ${cy + k} ${cx} ${cy + r}`,
        `Q${cx - k} ${cy + k} ${cx - r} ${cy}`,
        `Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`,
    ].join("");
}

function ray(angle: number, from: number, to: number): string {
    const t = (angle * Math.PI) / 180;
    const point = (r: number) =>
        `${(32 + r * Math.cos(t)).toFixed(2)} ${(24 + r * Math.sin(t)).toFixed(2)}`;
    return `M${point(from)}L${point(to)}`;
}

const FIREWORK_RAYS = [
    ray(-90, 6, 21),
    ray(-50, 6, 16),
    ray(-130, 6, 16),
    ray(-18, 6, 12),
    ray(-162, 6, 12),
];

function Tile({ palette, rx = 16 }: { palette: Palette; rx?: number }) {
    return <rect width="64" height="64" rx={rx} fill={palette.brand} />;
}

function Brain({ left, right }: { left: string; right: string }) {
    return (
        <>
            <path d={LEFT_HALF} fill={left} />
            <path d={RIGHT_HALF} fill={right} />
        </>
    );
}

function Layers({ palette }: { palette: Palette }) {
    return (
        <>
            <path
                d="M32 28L52 36L32 44L12 36Z"
                fill={palette.brand}
                stroke={palette.brand}
                strokeWidth="2"
                strokeLinejoin="round"
            />
            <g
                fill="none"
                stroke={palette.brand}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M12 43L32 51L52 43" />
                <path d="M12 50L32 58L52 50" />
            </g>
        </>
    );
}

const CORTEX: Mark[] = [
    {
        id: "00",
        name: "Cortex",
        note: "The current pick: two hemispheres cut from a cobalt tile.",
        draw: (p) => (
            <>
                <Tile palette={p} />
                <Brain left={p.glyph} right={p.glyph} />
            </>
        ),
    },
    {
        id: "01",
        name: "Folds",
        note: "One fold in each half, so it reads as a brain before it reads as a cloud.",
        draw: (p) => (
            <>
                <Tile palette={p} />
                <Brain left={p.glyph} right={p.glyph} />
                <g fill="none" stroke={p.brand} strokeWidth="2.4" strokeLinecap="round">
                    <path d="M24 27.5C21.5 29 21.5 35 24 36.5" />
                    <path d="M40 27.5C42.5 29 42.5 35 40 36.5" />
                </g>
            </>
        ),
    },
    {
        id: "02",
        name: "Line",
        note: "The same brain drawn as an outline in an open box. Lighter, for docs and print.",
        draw: (p) => (
            <>
                <rect
                    x="3"
                    y="3"
                    width="58"
                    height="58"
                    rx="15"
                    fill="none"
                    stroke={p.ink}
                    strokeWidth="3"
                />
                <g fill="none" stroke={p.brand} strokeWidth="3" strokeLinejoin="round">
                    <path d={LEFT_HALF} />
                    <path d={RIGHT_HALF} />
                </g>
            </>
        ),
    },
    {
        id: "03",
        name: "Duo",
        note: "Two tones: the base model and what you trained on top of it.",
        draw: (p) => (
            <>
                <Tile palette={p} />
                <Brain left={p.glyph} right={p.tint} />
            </>
        ),
    },
    {
        id: "04",
        name: "Bleed",
        note: "The brain fills the tile and runs off its edges. The boldest at small sizes.",
        draw: (p, uid) => (
            <>
                <defs>
                    <clipPath id={`bleed-${uid}`}>
                        <rect width="64" height="64" rx="12" />
                    </clipPath>
                </defs>
                <Tile palette={p} rx={12} />
                <g clipPath={`url(#bleed-${uid})`}>
                    <g transform="translate(32 34) scale(1.42) translate(-32 -31.4)">
                        <Brain left={p.glyph} right={p.glyph} />
                    </g>
                </g>
            </>
        ),
    },
    {
        id: "05",
        name: "Spark",
        note: "Cortex with a spark in the corner: brain power, and a nod to the fireworks set below.",
        draw: (p) => (
            <>
                <Tile palette={p} />
                <g transform="translate(-2 3)">
                    <Brain left={p.glyph} right={p.glyph} />
                </g>
                <path d={star(50.5, 12.5, 6.5)} fill={p.spark} />
            </>
        ),
    },
];

const STACK: Mark[] = [
    {
        id: "06",
        name: "Spark",
        note: "A stack of layers with sparks rising from the top.",
        draw: (p) => (
            <>
                <Layers palette={p} />
                <path d={star(32, 14, 10)} fill={p.spark} />
                <path d={star(46.5, 7.5, 3.6)} fill={p.spark} />
            </>
        ),
    },
    {
        id: "07",
        name: "Surge",
        note: "A bolt charging the stack: power going into the model.",
        draw: (p) => (
            <>
                <Layers palette={p} />
                <path
                    d={BOLT}
                    fill={p.spark}
                    stroke={p.spark}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                />
            </>
        ),
    },
    {
        id: "08",
        name: "Fireworks",
        note: "A stepped stack that bursts at the top, like a launcher going off.",
        draw: (p) => (
            <>
                <rect x="12" y="50" width="40" height="8" rx="3" fill={p.brand} />
                <rect x="17" y="40" width="30" height="8" rx="3" fill={p.brand} />
                <rect x="22" y="30" width="20" height="8" rx="3" fill={p.brand} />
                <g stroke={p.spark} strokeWidth="3.5" strokeLinecap="round">
                    {FIREWORK_RAYS.map((d) => (
                        <path key={d} d={d} />
                    ))}
                </g>
            </>
        ),
    },
    {
        id: "09",
        name: "Ascent",
        note: "Layers rising as chevrons, a spark at the peak.",
        draw: (p) => (
            <>
                <g
                    fill="none"
                    stroke={p.brand}
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M14 40L32 30L50 40" />
                    <path d="M14 50L32 40L50 50" />
                    <path d="M14 60L32 50L50 60" />
                </g>
                <path d={star(32, 15, 8)} fill={p.spark} />
                <circle cx="20" cy="20" r="2" fill={p.spark} />
                <circle cx="44" cy="20" r="2" fill={p.spark} />
            </>
        ),
    },
    {
        id: "10",
        name: "Breakout",
        note: "The stack inside a box, and a bolt breaking out through its lid.",
        draw: (p) => (
            <>
                <rect
                    x="5"
                    y="9"
                    width="54"
                    height="50"
                    rx="14"
                    fill="none"
                    stroke={p.ink}
                    strokeWidth="3"
                />
                <path
                    d="M32 30L46 36L32 42L18 36Z"
                    fill={p.brand}
                    stroke={p.brand}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                />
                <g
                    fill="none"
                    stroke={p.brand}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M18 41.5L32 47.5L46 41.5" />
                    <path d="M18 47L32 53L46 47" />
                </g>
                <path
                    d={BREAKOUT_BOLT}
                    fill={p.spark}
                    stroke={p.ground}
                    strokeWidth="4"
                    strokeLinejoin="round"
                    paintOrder="stroke"
                />
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

function MarkGrid({ marks }: { marks: Mark[] }) {
    return (
        <div className="grid grid-cols-3 gap-x-8 gap-y-10">
            {marks.map((mark) => (
                <MarkPreview key={mark.id} mark={mark} />
            ))}
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
            <Section
                title="Cortex"
                caption="A brain inside a box: the current pick and five variations."
            >
                <MarkGrid marks={CORTEX} />
            </Section>
            <Section
                title="Stack and sparks"
                caption="A stack of layers with sparks or bolts: brain power, fireworks."
            >
                <MarkGrid marks={STACK} />
            </Section>
        </Page>
    );
}
