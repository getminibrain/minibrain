import { IconDevices, IconKey, IconPalette, IconUser } from "@tabler/icons-react";
import { Badge, Button, Input, useToast } from "obp-ui";
import { type FormEvent, useState } from "react";
import {
    type Profile,
    type SignInSession,
    useChangePassword,
    useEndOtherSessions,
    useEndSession,
    useMySessions,
    useProfile,
    useRename,
} from "~/api/authQueries";
import { FormControl, FormRow, FormRows } from "~/components/FormRows";
import { ErrorLine } from "~/components/Section";
import { SettingsLayout } from "~/components/SettingsLayout";
import { SettingsSection, SettingsSections } from "~/components/SettingsSection";
import { ThemeChoice } from "~/components/ThemeChoice";
import { When } from "~/components/When";
import { ROLE_LABELS, SOURCE_LABELS } from "~/lib/access";
import { deviceName } from "~/lib/userAgent";
import { YOUR_ACCOUNT } from "~/pages/settings/settingsIndex";

const MIN_PASSWORD = 12;
const PROFILE_FORM = "profile-form";
const PASSWORD_FORM = "password-form";
const NAME_INPUT = "profile-name";
const PROFILE = YOUR_ACCOUNT.profile;
const PASSWORD = YOUR_ACCOUNT.password;
const SESSIONS = YOUR_ACCOUNT.sessions;
const APPEARANCE = YOUR_ACCOUNT.appearance;

function sessionsText(ended: number): string {
    return ended === 1 ? "1 other session" : `${ended} other sessions`;
}

function signInMethod(profile: Profile): string {
    const method = SOURCE_LABELS[profile.source] ?? profile.source;
    return profile.source === "oidc" && profile.provider
        ? `${method} (${profile.provider})`
        : method;
}

function ProfileSection({ profile }: { profile: Profile }) {
    const toast = useToast();
    const rename = useRename();
    const [name, setName] = useState(profile.name);
    const cleaned = name.trim().replace(/\s+/g, " ");
    const dirty = cleaned !== profile.name;
    const save = (event: FormEvent) => {
        event.preventDefault();
        rename.mutate(cleaned, {
            onSuccess: (saved) => {
                setName(saved.name);
                toast({ title: "Name saved", description: saved.name, tone: "success" });
            },
        });
    };
    return (
        <SettingsSection
            icon={IconUser}
            anchor={PROFILE.anchor}
            title={PROFILE.title}
            description="How you appear in the sidebar, on audit events and to admins."
            actions={
                <Button
                    type="submit"
                    form={PROFILE_FORM}
                    variant="outline"
                    disabled={!dirty || !cleaned || rename.isPending}
                >
                    Save
                </Button>
            }
        >
            <form id={PROFILE_FORM} onSubmit={save} className="flex flex-col gap-4">
                <FormRows>
                    <FormRow id={NAME_INPUT} label={PROFILE.settings.name.label}>
                        <Input
                            id={NAME_INPUT}
                            value={name}
                            maxLength={200}
                            autoComplete="name"
                            readOnly={rename.isPending}
                            onChange={(event) => setName(event.target.value)}
                            className="w-full max-w-sm"
                        />
                    </FormRow>
                    <FormRow
                        label={PROFILE.settings.email.label}
                        detail={profile.provider ? `Managed by ${profile.provider}` : undefined}
                    >
                        <span className="min-w-0 truncate">{profile.email ?? "No email"}</span>
                    </FormRow>
                    <FormRow
                        label={PROFILE.settings.role.label}
                        detail={profile.role_locked ? "From your groups" : "Set by an admin"}
                    >
                        <span>{profile.role ? ROLE_LABELS[profile.role] : "No role"}</span>
                    </FormRow>
                    <FormRow label={PROFILE.settings.signInMethod.label}>
                        <span>{signInMethod(profile)}</span>
                    </FormRow>
                </FormRows>
                <ErrorLine error={rename.error} />
            </form>
        </SettingsSection>
    );
}

function PasswordForm({ profile }: { profile: Profile }) {
    const toast = useToast();
    const change = useChangePassword();
    const [current, setCurrent] = useState("");
    const [password, setPassword] = useState("");
    const [again, setAgain] = useState("");
    const mismatch = again.length > 0 && again !== password;
    const ready = current.length > 0 && password.length >= MIN_PASSWORD && again === password;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        change.mutate(
            { current_password: current, password },
            {
                onSuccess: ({ ended }) => {
                    setCurrent("");
                    setPassword("");
                    setAgain("");
                    toast({
                        title: "Password changed",
                        description:
                            ended > 0
                                ? `Signed out ${sessionsText(ended)}.`
                                : "You stay signed in here.",
                        tone: "success",
                    });
                },
            },
        );
    };
    return (
        <SettingsSection
            icon={IconKey}
            anchor={PASSWORD.anchor}
            title={PASSWORD.title}
            description="Needs your current password. Changing it signs you out everywhere else."
            actions={
                <Button type="submit" form={PASSWORD_FORM} disabled={!ready || change.isPending}>
                    {change.isPending ? "Changing…" : "Change password"}
                </Button>
            }
        >
            <form id={PASSWORD_FORM} onSubmit={submit} className="flex flex-col gap-4">
                <input
                    type="email"
                    autoComplete="username"
                    value={profile.email ?? ""}
                    readOnly
                    hidden
                />
                <FormRows>
                    <FormRow id="current-password" label="Current password">
                        <FormControl>
                            <Input
                                id="current-password"
                                type="password"
                                autoComplete="current-password"
                                value={current}
                                onChange={(event) => setCurrent(event.target.value)}
                                required
                            />
                        </FormControl>
                    </FormRow>
                    <FormRow
                        id="new-password"
                        label="New password"
                        detail={`At least ${MIN_PASSWORD} characters`}
                    >
                        <FormControl>
                            <Input
                                id="new-password"
                                type="password"
                                autoComplete="new-password"
                                value={password}
                                minLength={MIN_PASSWORD}
                                onChange={(event) => setPassword(event.target.value)}
                                required
                            />
                        </FormControl>
                    </FormRow>
                    <FormRow id="new-password-again" label="New password again">
                        <FormControl>
                            <Input
                                id="new-password-again"
                                type="password"
                                autoComplete="new-password"
                                value={again}
                                aria-invalid={mismatch || undefined}
                                aria-describedby={mismatch ? "new-password-mismatch" : undefined}
                                onChange={(event) => setAgain(event.target.value)}
                                required
                            />
                            {mismatch && (
                                <span
                                    id="new-password-mismatch"
                                    className="text-sm text-destructive"
                                >
                                    The passwords do not match
                                </span>
                            )}
                        </FormControl>
                    </FormRow>
                </FormRows>
                <ErrorLine error={change.error} />
            </form>
        </SettingsSection>
    );
}

function PasswordSection({ profile }: { profile: Profile }) {
    if (profile.source === "local") {
        return <PasswordForm profile={profile} />;
    }
    return (
        <SettingsSection
            icon={IconKey}
            anchor={PASSWORD.anchor}
            title={PASSWORD.title}
            description="Single sign-on and proxy accounts have no password in minibrain."
        >
            <p className="text-muted-foreground">
                {`Your password is managed by ${profile.provider ?? "your identity provider"}.`}
            </p>
        </SettingsSection>
    );
}

function SessionRow({ row }: { row: SignInSession }) {
    const end = useEndSession();
    const ending = end.isPending;
    return (
        <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-panel py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2" title={row.user_agent ?? undefined}>
                    <span className="truncate">{deviceName(row.user_agent)}</span>
                    {row.current && <Badge variant="info">This device</Badge>}
                </span>
                <span className="text-sm text-muted-foreground">
                    <span className="font-mono">{row.ip ?? "Unknown address"}</span>
                    {" · "}
                    <span>
                        Signed in <When value={row.created_at} />
                    </span>
                    {" · "}
                    <span>
                        Last active <When value={row.last_seen_at} />
                    </span>
                </span>
                <ErrorLine error={end.error} />
            </div>
            {!row.current && (
                <Button
                    variant="outline"
                    size="sm"
                    disabled={ending}
                    onClick={() => end.mutate(row.id)}
                >
                    {ending ? "Signing out…" : "Sign out"}
                </Button>
            )}
        </li>
    );
}

function SessionsSection({ profile }: { profile: Profile }) {
    const toast = useToast();
    const sessions = useMySessions();
    const endOthers = useEndOtherSessions();
    const rows = sessions.data ?? [];
    const others = rows.filter((row) => !row.current).length;
    const proxied = profile.source === "proxy";
    const signOutOthers = () =>
        endOthers.mutate(undefined, {
            onSuccess: ({ ended }) =>
                toast({
                    title: "Signed out everywhere else",
                    description: `Ended ${sessionsText(ended)}.`,
                    tone: "success",
                }),
        });
    return (
        <SettingsSection
            icon={IconDevices}
            anchor={SESSIONS.anchor}
            title={SESSIONS.title}
            description={
                proxied
                    ? "Your sign-in proxy keeps your sessions."
                    : "Browsers signed in to your account. Sign out any you do not recognise."
            }
            flush={!proxied && rows.length > 0}
            actions={
                proxied ? undefined : (
                    <Button
                        variant="outline"
                        disabled={others === 0 || endOthers.isPending}
                        onClick={signOutOthers}
                    >
                        {SESSIONS.settings.signOutOthers.label}
                    </Button>
                )
            }
        >
            {proxied ? (
                <p className="text-muted-foreground">
                    You sign in through your sign-in proxy, so minibrain keeps no sessions for you.
                    Sign out there.
                </p>
            ) : rows.length > 0 ? (
                <ul className="divide-y">
                    {rows.map((row) => (
                        <SessionRow key={row.id} row={row} />
                    ))}
                </ul>
            ) : (
                <p className="text-muted-foreground">
                    {sessions.isPending ? "Loading sessions…" : "No sessions."}
                </p>
            )}
            {(sessions.error || endOthers.error) && (
                <div className={rows.length > 0 ? "border-t px-panel py-3" : "pt-3"}>
                    <ErrorLine
                        error={sessions.error ?? endOthers.error}
                        onRetry={sessions.refetch}
                    />
                </div>
            )}
        </SettingsSection>
    );
}

export function YourAccountPage() {
    const profile = useProfile();
    const data = profile.data;
    return (
        <SettingsLayout
            title="Your account"
            caption="Your name, password, signed-in browsers and theme. Changes here apply to you only."
        >
            <ErrorLine error={profile.error} onRetry={profile.refetch} />
            <SettingsSections>
                {data && <ProfileSection profile={data} />}
                {data && <PasswordSection profile={data} />}
                {data && <SessionsSection profile={data} />}
                <SettingsSection
                    icon={IconPalette}
                    anchor={APPEARANCE.anchor}
                    title={APPEARANCE.title}
                    description="Light, dark or your device's setting, for this browser."
                >
                    <ThemeChoice />
                </SettingsSection>
            </SettingsSections>
        </SettingsLayout>
    );
}
