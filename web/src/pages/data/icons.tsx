import {
    IconBuildingWarehouse,
    IconCloud,
    IconDatabase,
    IconFolder,
    IconFolderUp,
    type TablerIcon,
} from "@tabler/icons-react";
import { FileTypeIcon } from "obp-ui";
import type { SourceSummary } from "~/api/client";
import { type SourceGroupId, groupOf, tableFormat } from "./catalogue";

export const GROUP_ICONS: Record<SourceGroupId, TablerIcon> = {
    upload: IconFolderUp,
    folder: IconFolder,
    s3: IconCloud,
    database: IconDatabase,
    lakehouse: IconBuildingWarehouse,
};

export function GroupIcon({ group, className }: { group: SourceGroupId; className?: string }) {
    const Icon = GROUP_ICONS[group];
    return <Icon aria-hidden="true" className={className} />;
}

export function SourceIcon({ source, className }: { source: SourceSummary; className?: string }) {
    const format = tableFormat(source.kind);
    if (format) {
        return <FileTypeIcon type={format} className={className} />;
    }
    if (source.kind === "upload") {
        return <FileTypeIcon name={source.filename || source.name} className={className} />;
    }
    return <GroupIcon group={groupOf(source.kind).id} className={className} />;
}
