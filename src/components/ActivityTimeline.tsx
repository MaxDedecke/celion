import { Check, X, Edit, Plus, Download, Settings as SettingsIcon, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";
import { getWorkflowTheme } from "@/components/migration/workflowThemes";

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
        return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
      case "error":
        return "text-rose-600 dark:text-rose-400 bg-rose-500/10";
      case "info":
        return "text-sky-600 dark:text-sky-400 bg-sky-500/10";
      case "warning":
        return "text-amber-600 dark:text-amber-400 bg-amber-500/10";
      case "system":
        return "text-violet-600 dark:text-violet-400 bg-violet-500/10";
      default:
        return "text-muted-foreground bg-muted/50";
    }
  };

  const extractStepFromTitle = (title: string): { stepInfo: typeof AGENT_WORKFLOW_STEPS[number] | null; cleanTitle: string } => {
    const stepKeywords = [
      { key: "system-detection", patterns: ["System Detection", "Systeme erkannt", "System erkannt"] },
      { key: "auth-flow", patterns: ["Authentifizierung", "Auth Flow", "Authenticated"] },
      { key: "schema-discovery", patterns: ["Capability Discovery", "Schema Discovery", "API-Spezifikation"] },
      { key: "model-mapping", patterns: ["Model Mapping", "Meta-Modell"] },
      { key: "target-schema", patterns: ["Target Schema", "Zielsystem analysiert"] },
      { key: "mapping-suggestion", patterns: ["Mapping Suggestion", "Feld-Mapping"] },
      { key: "consistency-validation", patterns: ["Consistency", "Validation", "Validierung"] },
      { key: "dry-run", patterns: ["Dry-Run", "Simulation"] },
      { key: "data-transfer", patterns: ["Data Transfer", "Migration", "Datenmigration"] },
      { key: "verification", patterns: ["Verification", "Verifikation"] },
      { key: "audit", patterns: ["Audit", "Logging"] },
      { key: "feedback", patterns: ["Feedback", "Learning", "Optimization"] },
    ];

    for (const stepKeyword of stepKeywords) {
      for (const pattern of stepKeyword.patterns) {
        if (title.includes(pattern)) {
          const stepInfo = AGENT_WORKFLOW_STEPS.find(s => s.id === stepKeyword.key);
          return { stepInfo: stepInfo || null, cleanTitle: title };
        }
      }
    }

    return { stepInfo: null, cleanTitle: title };
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
    <div className="space-y-3">
      {activities.map((activity) => {
        const { stepInfo, cleanTitle } = extractStepFromTitle(activity.title);
        const theme = stepInfo ? getWorkflowTheme(stepInfo.color) : null;

        return (
          <div 
            key={activity.id} 
            className="group relative flex flex-col gap-2 rounded-lg border border-border/50 bg-card/50 p-3 transition-all hover:border-border hover:bg-card hover:shadow-sm"
          >
            {stepInfo && (
              <Badge 
                variant="outline" 
                className={`${theme?.accentBadge} w-fit shrink-0 border-0 text-xs`}
              >
                {stepInfo.phase}
              </Badge>
            )}
            <div className="flex items-start gap-3">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${getColorClass(activity.type)}`}>
                {getIcon(activity.type)}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm font-medium text-foreground">{cleanTitle}</p>
                <p className="text-xs text-muted-foreground">{formatTimestamp(activity.timestamp)}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ActivityTimeline;
