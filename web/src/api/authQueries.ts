import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, clearSignOutReason, onSignedOut, setCsrfToken, succeed, unwrap } from "./client";
import type { components } from "./schema";

type Schemas = components["schemas"];

export type SessionInfo = Schemas["SessionInfo"];
export type PersonInfo = Schemas["PersonInfo"];
export type AccountInfo = Schemas["AccountInfo"];
export type PasswordLink = Schemas["PasswordLink"];
export type Role = NonNullable<PersonInfo["role"]>;
export type Profile = Schemas["Profile"];
export type SignInSession = Schemas["SignInSession"];

export const authKeys = {
    session: ["auth", "session"] as const,
    accounts: ["accounts"] as const,
    me: ["me"] as const,
    mySessions: ["me", "sessions"] as const,
};

async function loadSession(): Promise<SessionInfo> {
    const info = await unwrap(api.GET("/api/auth/session"));
    setCsrfToken(info.csrf_token ?? null);
    return info;
}

function forgetOtherPeople(client: QueryClient): void {
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
}

function personId(info: SessionInfo | undefined): number | null {
    return info?.person?.id ?? null;
}

export function useSession() {
    const client = useQueryClient();
    useEffect(
        () =>
            onSignedOut(() => {
                void client.invalidateQueries({ queryKey: authKeys.session });
            }),
        [client],
    );
    return useQuery({
        queryKey: authKeys.session,
        queryFn: async () => {
            const info = await loadSession();
            const before = client.getQueryData<SessionInfo>(authKeys.session);
            if (before && personId(before) !== personId(info)) {
                forgetOtherPeople(client);
            }
            return info;
        },
        staleTime: 60_000,
    });
}

export function usePerson(): PersonInfo | null {
    return useSession().data?.person ?? null;
}

function useSignedIn() {
    const client = useQueryClient();
    return async (info: SessionInfo) => {
        clearSignOutReason();
        setCsrfToken(info.csrf_token ?? null);
        forgetOtherPeople(client);
        client.setQueryData(authKeys.session, info);
    };
}

export function useSignIn() {
    const signedIn = useSignedIn();
    return useMutation({
        mutationFn: (body: Schemas["SignInBody"]) => unwrap(api.POST("/api/auth/login", { body })),
        onSuccess: signedIn,
    });
}

export function useSetup() {
    const signedIn = useSignedIn();
    return useMutation({
        mutationFn: (body: Schemas["SetupBody"]) => unwrap(api.POST("/api/auth/setup", { body })),
        onSuccess: signedIn,
    });
}

export function useSetPassword() {
    const signedIn = useSignedIn();
    return useMutation({
        mutationFn: (body: Schemas["ResetBody"]) => unwrap(api.POST("/api/auth/reset", { body })),
        onSuccess: signedIn,
    });
}

export function useSignOut() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => succeed(api.POST("/api/auth/logout")),
        onSettled: async () => {
            setCsrfToken(null);
            const info = await loadSession();
            forgetOtherPeople(client);
            client.setQueryData(authKeys.session, info);
        },
    });
}

export function useAccounts(enabled: boolean) {
    return useQuery({
        queryKey: authKeys.accounts,
        queryFn: () => unwrap(api.GET("/api/accounts")),
        enabled,
    });
}

export function useProfile() {
    return useQuery({ queryKey: authKeys.me, queryFn: () => unwrap(api.GET("/api/me")) });
}

export function useRename() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (name: string) => unwrap(api.PATCH("/api/me", { body: { name } })),
        onSuccess: async (profile) => {
            client.setQueryData(authKeys.me, profile);
            await client.invalidateQueries({ queryKey: authKeys.session });
            await client.invalidateQueries({ queryKey: authKeys.accounts });
            await client.invalidateQueries({ queryKey: ["audit"] });
        },
    });
}

export function useChangePassword() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (body: Schemas["PasswordChange"]) =>
            unwrap(api.POST("/api/me/password", { body })),
        onSuccess: () => client.invalidateQueries({ queryKey: authKeys.mySessions }),
    });
}

export function useMySessions() {
    return useQuery({
        queryKey: authKeys.mySessions,
        queryFn: () => unwrap(api.GET("/api/me/sessions")),
    });
}

export function useEndSession() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: number) =>
            succeed(
                api.DELETE("/api/me/sessions/{session_id}", {
                    params: { path: { session_id: id } },
                }),
            ),
        onSettled: () => client.invalidateQueries({ queryKey: authKeys.mySessions }),
    });
}

export function useEndOtherSessions() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => unwrap(api.DELETE("/api/me/sessions")),
        onSettled: () => client.invalidateQueries({ queryKey: authKeys.mySessions }),
    });
}
