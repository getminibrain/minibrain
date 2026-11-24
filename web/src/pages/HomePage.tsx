import { IconPlus } from "@tabler/icons-react";
import { Button, Link } from "obp-ui";
import { HealthPanel } from "~/components/HealthPanel";
import { PageHeader } from "~/components/PageHeader";
import { Page, PanelColumns, PanelSections } from "~/components/Section";
import { useCan } from "~/lib/access";
import { JobsPanel } from "./home/JobsPanel";
import { JourneyStrip } from "./home/JourneyStrip";
import { ModelsPanel } from "./home/ModelsPanel";
import { useHomeData } from "./home/data";

export function HomePage() {
    const can = useCan();
    const data = useHomeData();
    return (
        <Page wide>
            <PageHeader
                title="Home"
                actions={
                    can.build && (
                        <Button asChild>
                            <Link href="/models/new">
                                <IconPlus aria-hidden="true" />
                                Add model
                            </Link>
                        </Button>
                    )
                }
            />
            <PanelSections>
                <JourneyStrip data={data} />
                <ModelsPanel data={data} />
                <PanelColumns>
                    <HealthPanel />
                    <JobsPanel data={data} />
                </PanelColumns>
            </PanelSections>
        </Page>
    );
}
