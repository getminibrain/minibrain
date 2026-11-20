export const PRODUCT_NAME = "minibrain";

export const MARK_TILES = { light: "#1b1c1d", dark: "#34373d" } as const;

export type MarkTheme = keyof typeof MARK_TILES;

const GLYPH = "#ffffff";

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

function markSvg(tile: string, style = ""): string {
    return [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
        style,
        `<circle class="tile" cx="32" cy="32" r="32" fill="${tile}"/>`,
        '<mask id="fissure" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">',
        '<rect width="64" height="64" fill="#fff"/><rect x="30.2" y="0" width="3.6" height="64" fill="#000"/>',
        "</mask>",
        `<g mask="url(#fissure)" fill="${GLYPH}"><path d="${BRAIN}"/>`,
        `<path d="${ECHO}" fill="none" stroke="${GLYPH}" stroke-width="2" stroke-linejoin="round"/></g>`,
        "</svg>",
    ].join("");
}

function dataUrl(svg: string): string {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const MARK_URLS: Record<MarkTheme, string> = {
    light: dataUrl(markSvg(MARK_TILES.light)),
    dark: dataUrl(markSvg(MARK_TILES.dark)),
};

export function installFavicon(): void {
    const style = `<style>@media (prefers-color-scheme: dark){.tile{fill:${MARK_TILES.dark}}}</style>`;
    const link =
        document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
        document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = dataUrl(markSvg(MARK_TILES.light, style));
    document.head.append(link);
}
