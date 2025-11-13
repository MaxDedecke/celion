import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SystemDetectionResult } from "@/types/agents";

interface AgentOutputDisplayProps {
  result: SystemDetectionResult;
}

const AgentOutputDisplay = ({ result }: AgentOutputDisplayProps) => {
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

  return (
    <div className="space-y-4">
      {/* Detection Status */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            {result.detected ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium">
                {result.detected ? "System erfolgreich erkannt" : "System nicht erkannt"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Erkennungsstatus
              </p>
            </div>
            <Badge variant={result.detected ? "default" : "destructive"}>
              {result.detected ? "Erkannt" : "Nicht erkannt"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* System Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">System</p>
              <p className="text-sm font-medium">
                {result.system || (
                  <span className="text-muted-foreground italic">Nicht verfügbar</span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">API Version</p>
              <p className="text-sm font-medium">
                {result.api_version || (
                  <span className="text-muted-foreground italic">Nicht verfügbar</span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Base URL</p>
              <p className="text-sm font-medium break-all">
                {result.base_url || (
                  <span className="text-muted-foreground italic">Nicht verfügbar</span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
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
          </CardContent>
        </Card>
      </div>

      {/* Detection Evidence */}
      {result.detection_evidence && Object.keys(result.detection_evidence).length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
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
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AgentOutputDisplay;
