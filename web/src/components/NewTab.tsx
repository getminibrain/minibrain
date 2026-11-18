import { IconExternalLink } from "@tabler/icons-react";
import { type ReactNode, createContext, useContext } from "react";

const NewTabContext = createContext(false);

export function NewTabLinks({ children }: { children: ReactNode }) {
    return <NewTabContext.Provider value>{children}</NewTabContext.Provider>;
}

export function useNewTab(force = false): { target?: "_blank"; rel?: string } {
    const inside = useContext(NewTabContext);
    return force || inside ? { target: "_blank", rel: "noopener noreferrer" } : {};
}

export function NewTabIcon({ force = false }: { force?: boolean }) {
    const inside = useContext(NewTabContext);
    return force || inside ? (
        <IconExternalLink
            aria-label="opens in a new tab"
            className="ml-0.5 inline size-3.5 shrink-0"
        />
    ) : null;
}
