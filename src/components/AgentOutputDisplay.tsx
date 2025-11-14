import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SystemDetectionResult } from "@/types/agents";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AgentOutputDisplayProps {
  sourceResult?: SystemDetectionResult | null;
  targetResult?: SystemDetectionResult | null;
}

const AgentOutputDisplay = ({ sourceResult, targetResult }: AgentOutputDisplayProps) => {
  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return "text-muted-foreground";
    if (confidence >= 0.8) return "text-green-600 dark:text-green-400";
    if (confidence >= 0.5) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getConfidenceBadge = (confidence: number | null) => {
    if (confidence === null) return "default";
    if (confidence >= 0.8) return "default";
    if (confidence >= 0.5) return "secondary";
    return "destructive";
  };

  const renderSystemDetails = (result: SystemDetectionResult | null | undefined, title: string) => {
    if (!result) {
      return (
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-lg">{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground italic">Noch keine Daten verfügbar</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {title}
            {result.detected ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Detection Status */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge variant={result.detected ? "default" : "destructive"}>
              {result.detected ? "Erkannt" : "Nicht erkannt"}
            </Badge>
          </div>

          {/* System Information */}
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">System</p>
              <p className="text-sm font-medium">
                {result.system || (
                  <span className="text-muted-foreground italic">Nicht verfügbar</span>
                )}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">API Version</p>
              <p className="text-sm font-medium">
                {result.api_version || (
                  <span className="text-muted-foreground italic">Nicht verfügbar</span>
                )}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Base URL</p>
              <p className="text-sm font-medium break-all">
                {result.base_url || (
                  <span className="text-muted-foreground italic">Nicht verfügbar</span>
                )}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Konfidenz</p>
              <div className="flex items-center gap-2">
                <p className={cn("text-sm font-medium", getConfidenceColor(result.confidence))}>
                  {result.confidence !== null
                    ? `${Math.round(result.confidence * 100)}%`
                    : "Nicht verfügbar"}
                </p>
                {result.confidence !== null && (
                  <Badge variant={getConfidenceBadge(result.confidence)} className="text-xs">
                    {result.confidence >= 0.8 ? "Hoch" : result.confidence >= 0.5 ? "Mittel" : "Niedrig"}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Detection Evidence */}
          {result.detection_evidence && Object.keys(result.detection_evidence).length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground">Erkennungs-Details</p>
              </div>
              <div className="space-y-2">
                {Object.entries(result.detection_evidence).map(([key, value]) => {
                  if (key === "raw" || key === "raw_response") return null;
                  
                  let displayValue: string;
                  if (Array.isArray(value)) {
                    displayValue = value.join(", ");
                  } else if (typeof value === "object" && value !== null) {
                    displayValue = JSON.stringify(value, null, 2);
                  } else {
                    displayValue = String(value);
                  }

                  return (
                    <div key={key} className="flex flex-col gap-1 p-3 rounded-md bg-muted/40">
                      <p className="text-xs font-medium text-foreground">{key}</p>
                      <p className="text-xs text-muted-foreground font-mono break-all">
                        {displayValue}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Raw Output Collapsible */}
          {result.raw_output && (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                <ChevronDown className="h-4 w-4" />
                Raw Output anzeigen
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <ScrollArea className="h-[200px] w-full rounded-md border bg-muted/40 p-3">
                  <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">
                    {result.raw_output}
                  </pre>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {renderSystemDetails(sourceResult, "Quellsystem")}
      {renderSystemDetails(targetResult, "Zielsystem")}
    </div>
  );
};

export default AgentOutputDisplay;
