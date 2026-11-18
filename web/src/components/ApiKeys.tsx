import { IconKey } from "@tabler/icons-react";
import { Button } from "obp-ui";
import type { ReactNode } from "react";
import type { KeyCreated, ModelRef } from "~/api/client";
import { useKeys } from "~/api/queries";
import { SectionError } from "~/components/ErrorState";
import { PanelSection } from "~/components/Section";
import { KeysTable, useKeyManager } from "~/components/keys/KeysTable";
import { keyCovers } from "~/components/keys/scope";

export function ApiKeys({
    scope,
    onCreated,
    secretActions,
    description,
}: {
    scope: ModelRef;
    onCreated?: (key: KeyCreated) => void;
    secretActions?: ReactNode;
    description?: ReactNode;
}) {
    const list = useKeys();
    const manager = useKeyManager(onCreated, secretActions);
    const rows = (list.data ?? []).filter((key) => keyCovers(key, scope));
    return (
        <PanelSection
            icon={IconKey}
            title="API keys"
            description={description}
            actions={
                <Button onClick={() => manager.create([scope])}>
                    <IconKey aria-hidden="true" />
                    Create key
                </Button>
            }
            bare
        >
            <div className="flex flex-col gap-3">
                <KeysTable
                    rows={rows}
                    loading={list.isLoading}
                    storageKey="minibrain.keys.model"
                    empty={
                        list.error ? (
                            <SectionError error={list.error} retry={list.refetch} />
                        ) : (
                            "No keys can call this model yet."
                        )
                    }
                    onEdit={manager.edit}
                    onRevoke={manager.revoke}
                />
            </div>
            {manager.dialogs}
        </PanelSection>
    );
}
