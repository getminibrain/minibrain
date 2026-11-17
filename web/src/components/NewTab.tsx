import { IconExternalLink } from "@tabler/icons-react";
import { type ReactNode, createContext, useContext } from "react";

const NewTabContext = createContext(false);

export function NewTabLinks({ children }: { children: ReactNode }) {
    return <NewTabContext.Provider value>{children}</NewTabContext.Provider>;
}

export function useNewTab(): { target?: "_blank"; rel?: string } {
    return useContext(NewTabContext) ? { target: "_blank", rel: "noreferrer" } : {};
}

export function NewTabIcon() {
    return useContext(NewTabContext) ? (
        <IconExternalLink
            aria-label="opens in a new tab"
            className="ml-0.5 inline size-3.5 shrink-0"
        />
    ) : null;
}
