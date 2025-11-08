import { Check, X, Edit, Plus, Download, Settings as SettingsIcon, Play } from "lucide-react";

export interface Activity {
  id: string;
  type: "success" | "error" | "info" | "warning" | "system";
  title: string;
  timestamp: string;
}

interface ActivityTimelineProps {
  activities: Activity[];
}

const ActivityTimeline = ({ activities }: ActivityTimelineProps) => {
  const getIcon = (type: string) => {
    switch (type) {
      case "success":
        return <Check className="h-4 w-4" />;
      case "error":
        return <X className="h-4 w-4" />;
      case "info":
        return <Download className="h-4 w-4" />;
      case "warning":
        return <Edit className="h-4 w-4" />;
      case "system":
        return <SettingsIcon className="h-4 w-4" />;
      default:
        return <Plus className="h-4 w-4" />;
    }
  };

  const getColorClass = (type: string) => {
    switch (type) {
      case "success":
        return "text-success";
      case "error":
        return "text-destructive";
      case "info":
        return "text-info";
      case "warning":
        return "text-warning";
      case "system":
        return "text-primary";
      default:
        return "text-muted-foreground";
    }
  };

  const formatTimestamp = (value: string) => {
    if (!value) {
      return "";
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
      return value;
    }

    return parsedDate.toLocaleString("de-DE");
  };

  return (
    <div className="space-y-4">
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-start gap-3">
          <div className={`mt-1 ${getColorClass(activity.type)}`}>
            {getIcon(activity.type)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground">{activity.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{formatTimestamp(activity.timestamp)}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ActivityTimeline;
