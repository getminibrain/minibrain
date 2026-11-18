import {
    IconAlertCircle,
    IconLock,
    IconWifiOff,
    IconZoomCancel,
    type TablerIcon,
} from "@tabler/icons-react";
import { useRouterState } from "@tanstack/react-router";
import { Button, type ErrorDetail, ErrorPanel, type ErrorPanelVariant, Link } from "obp-ui";
import type { ReactNode } from "react";
import { errorStatus, isUnreachable } from "~/api/client";
import { type Crumb, PageCrumbs } from "~/components/PageCrumbs";
import { PageHeader } from "~/components/PageHeader";
import { RetryButton } from "~/components/RetryButton";
import { Page, errorMessage } from "~/components/Section";
import { navEntryFor } from "~/components/navigation";
import { errorDetails } from "~/lib/errorDetails";

export type ErrorAction = { label: string; href?: string; onClick?: () => void };

export const GO_HOME: ErrorAction = { label: "Go home", href: "/" };

function ActionButton({ action, primary }: { action: ErrorAction; primary: boolean }) {
    const variant = primary ? "default" : "outline";
    if (action.href) {
        return (
            <Button asChild variant={variant}>
                <Link href={action.href}>{action.label}</Link>
            </Button>
        );
    }
    return (
        <Button variant={variant} onClick={action.onClick}>
            {action.label}
        </Button>
    );
}

function Actions({ primary, secondary }: { primary?: ErrorAction; secondary?: ErrorAction }) {
    if (!primary && !secondary) {
        return null;
    }
    return (
        <>
            {primary && <ActionButton action={primary} primary />}
            {secondary && <ActionButton action={secondary} primary={false} />}
        </>
    );
}

function usePathname(): string {
    return useRouterState({ select: (state) => state.location.pathname });
}

function pageDetails(status: string, pathname: string): ErrorDetail[] {
    return [
        { label: "Status", value: status },
        { label: "Path", value: pathname },
    ];
}

export function ErrorState({
    icon,
    title,
    children,
    detail,
    actions,
    primary,
    secondary,
    details,
    tone = "destructive",
    heading = "h1",
    variant = "plate",
    className,
}: {
    icon?: TablerIcon;
    title: string;
    children?: ReactNode;
    detail?: ReactNode;
    actions?: ReactNode;
    primary?: ErrorAction;
    secondary?: ErrorAction;
    details?: ErrorDetail[];
    tone?: "destructive" | "neutral";
    heading?: "h1" | "h2" | "h3";
    variant?: ErrorPanelVariant;
    className?: string;
}) {
    const message =
        children || detail ? (
            <>
                {children}
                {detail && <span className="mt-2 block">{detail}</span>}
            </>
        ) : undefined;
    return (
        <ErrorPanel
            variant={variant}
            tone={tone}
            icon={icon}
            title={title}
            heading={heading}
            actions={actions ?? <Actions primary={primary} secondary={secondary} />}
            details={details}
            className={className}
        >
            {message}
        </ErrorPanel>
    );
}

export function NotFoundState({
    title,
    children,
    detail,
    primary,
    secondary,
    heading = "h1",
}: {
    title: string;
    children: ReactNode;
    detail?: ReactNode;
    primary: ErrorAction;
    secondary?: ErrorAction;
    heading?: "h1" | "h2";
}) {
    const pathname = usePathname();
    return (
        <ErrorState
            icon={IconZoomCancel}
            tone="neutral"
            title={title}
            detail={detail}
            primary={primary}
            secondary={secondary}
            details={pageDetails("404", pathname)}
            heading={heading}
        >
            {children}
        </ErrorState>
    );
}

export function ForbiddenState({
    needs,
    heading,
    details,
    variant,
}: {
    needs: ReactNode;
    heading?: "h1" | "h2" | "h3";
    details?: ErrorDetail[];
    variant?: ErrorPanelVariant;
}) {
    const pathname = usePathname();
    return (
        <ErrorState
            icon={IconLock}
            tone="neutral"
            title="You don't have access"
            primary={variant === "inset" ? undefined : GO_HOME}
            details={details ?? pageDetails("403", pathname)}
            heading={heading}
            variant={variant}
        >
            {needs}
        </ErrorState>
    );
}

export function QueryError({
    error,
    retry,
    notFound,
    heading,
    variant = "plate",
    title = "Couldn't load this page",
    className,
}: {
    error: unknown;
    retry?: () => unknown;
    notFound?: ReactNode;
    heading?: "h1" | "h2" | "h3";
    variant?: ErrorPanelVariant;
    title?: string;
    className?: string;
}) {
    const message = errorMessage(error);
    if (!message) {
        return null;
    }
    const status = errorStatus(error);
    if (status === 404 && notFound) {
        return notFound;
    }
    if (status === 403) {
        return (
            <ForbiddenState
                needs={`${message}. Ask an admin to change your role under Settings, Accounts.`}
                heading={heading}
                details={errorDetails(error)}
                variant={variant}
            />
        );
    }
    const actions = retry ? (
        <RetryButton
            retry={retry}
            primary={variant === "plate"}
            size={variant === "inset" ? "sm" : undefined}
        />
    ) : variant === "plate" ? (
        <ActionButton action={GO_HOME} primary />
    ) : undefined;
    return (
        <ErrorState
            icon={isUnreachable(error) ? IconWifiOff : IconAlertCircle}
            title={title}
            actions={actions}
            details={errorDetails(error)}
            heading={heading}
            variant={variant}
            className={className}
        >
            {message}
        </ErrorState>
    );
}

export function SectionError({
    error,
    retry,
    title = "Couldn't load",
    className,
}: {
    error: unknown;
    retry?: () => unknown;
    title?: string;
    className?: string;
}) {
    return (
        <QueryError
            error={error}
            retry={retry}
            heading="h3"
            variant="inset"
            title={title}
            className={className}
        />
    );
}

export function ErrorPage({ fallback, children }: { fallback: string; children: ReactNode }) {
    const pathname = usePathname();
    return (
        <Page>
            <PageHeader title={navEntryFor(pathname)?.label ?? fallback} />
            {children}
        </Page>
    );
}

function sectionCrumbs(pathname: string): Crumb[] {
    const entry = navEntryFor(pathname);
    if (!entry) {
        return [{ label: "Home", href: "/" }];
    }
    return entry.group === "Settings"
        ? [{ label: "Settings", href: "/settings" }]
        : [{ label: entry.label, href: entry.path }];
}

export function NotFoundPage() {
    const pathname = usePathname();
    return (
        <Page>
            <PageCrumbs items={sectionCrumbs(pathname)} />
            <NotFoundState title="Page not found" primary={GO_HOME}>
                Nothing lives at this address.
            </NotFoundState>
        </Page>
    );
}

function reload() {
    window.location.reload();
}

export function CrashPage({ error }: { error: unknown }) {
    const pathname = usePathname();
    const message = errorMessage(error) ?? "Unknown error";
    return (
        <ErrorPage fallback="Something went wrong">
            <ErrorState
                title="This page hit an unexpected error"
                heading="h2"
                primary={{ label: "Reload", onClick: reload }}
                details={[
                    { label: "Error", value: message },
                    { label: "Path", value: pathname },
                ]}
            />
        </ErrorPage>
    );
}
