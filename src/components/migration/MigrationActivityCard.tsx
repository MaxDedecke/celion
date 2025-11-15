import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import ActivityTimeline, { Activity } from "@/components/ActivityTimeline";

interface MigrationActivityCardProps {
  activities: Activity[];
  matchHeight: number | null;
  isWideLayout: boolean;
}

const MigrationActivityCard = ({ activities, matchHeight, isWideLayout }: MigrationActivityCardProps) => {
  return (
    <Card
      className="flex flex-col overflow-hidden border-border bg-card"
      style={{ height: isWideLayout && matchHeight ? `${matchHeight}px` : "600px" }}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Aktivitäten</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden pt-0">
        <ScrollArea className="h-full pr-3">
          <ActivityTimeline activities={activities} />
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default MigrationActivityCard;
