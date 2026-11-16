import { Breadcrumbs, type Crumb } from "~/components/Breadcrumbs";

export type { Crumb };

function parentsOf(items: Crumb[]): Crumb[] {
    return items.at(-1)?.href ? items : items.slice(0, -1);
}

export function PageCrumbs({ items }: { items: Crumb[] }) {
    const parents = parentsOf(items);
    return parents.length > 0 ? <Breadcrumbs items={parents} /> : null;
}
