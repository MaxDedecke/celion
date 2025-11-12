import { Power } from "lucide-react";
import type { SystemDetectionResult } from "@/types/agents";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";

interface SystemDetectionOverviewProps {
  result: SystemDetectionResult;
  confidencePercent: number | null;
  headerSummary: string | null;
  statusSummary: string | null;
  fallbackBaseUrl?: string | null;
  className?: string;
}

const SystemDetectionOverview = ({
  result,
  confidencePercent,
  headerSummary,
  statusSummary,
  fallbackBaseUrl,
  className,
}: SystemDetectionOverviewProps) => {
  const baseUrl = result.base_url || fallbackBaseUrl || "Keine Basis-URL hinterlegt";

  return (
    <div className={cn("rounded-lg border border-border/60 bg-background/80 p-3", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-1 items-start gap-2">
          <Power className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-semibold">System Detection</p>
            <p className="text-xs text-muted-foreground">{baseUrl}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={result.detected ? "secondary" : "outline"}
            className={cn(
              "text-xs",
              result.detected
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                : "text-muted-foreground",
            )}
          >
            {result.detected ? "Erkannt" : "Unklar"}
          </Badge>
          {confidencePercent !== null && (
            <Badge variant="outline" className="text-xs">
              {confidencePercent}% Confidence
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p>
          System: <span className="font-medium text-foreground">{result.system ?? "Keine Angabe"}</span>
        </p>
        <p>
          API-Version: <span className="font-medium text-foreground">{result.api_version ?? "Keine Angabe"}</span>
        </p>
        {headerSummary && (
          <p>
            Header-Indikatoren: <span className="font-medium text-foreground">{headerSummary}</span>
          </p>
        )}
        {statusSummary && (
          <p>
            Statuscodes: <span className="font-medium text-foreground">{statusSummary}</span>
          </p>
        )}
      </div>
    </div>
  );
};

export default SystemDetectionOverview;
