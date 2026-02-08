import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { SystemDetectionResult, AuthFlowResult, CapabilityDiscoveryResult } from "@/types/agents";
import { AlertCircle, CheckCircle2, Download, XCircle, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AgentOutputDisplayProps {
  sourceResult?: SystemDetectionResult | AuthFlowResult | null;
  targetResult?: SystemDetectionResult | AuthFlowResult | null;
  schemaResult?: CapabilityDiscoveryResult | null;
}

const AgentOutputDisplay = ({ sourceResult, targetResult, schemaResult }: AgentOutputDisplayProps) => {
  const { toast } = useToast();

  const handleCopyResult = (result: any, title: string) => {
    if (result) {
      navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      toast({
        title: "Kopiert",
        description: `${title} Ergebnis wurde in die Zwischenablage kopiert.`,
      });
    }
  };

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

  const downloadRawOutput = (rawOutput: string, title: string) => {
    const fileName = `${title.toLowerCase().replace(/\s+/g, "-")}-raw-output.txt`;
    const blob = new Blob([rawOutput], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const renderSchemaDetails = (result: CapabilityDiscoveryResult | null | undefined) => {
    if (!result) {
      return (
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-lg">Capability Discovery</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground italic">Noch keine Daten verfügbar</p>
          </CardContent>
        </Card>
      );
    }

    const objectEntries = Object.entries(result.objects || {});

    return (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">Capability Discovery</CardTitle>
            <button
              onClick={() => handleCopyResult(result, "Capability Discovery")}
              className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="JSON kopieren"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">System: {result.system || "Unbekannt"}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Objekte ({objectEntries.length})
            </p>
            {objectEntries.length > 0 ? (
              <div className="space-y-2">
                {objectEntries.map(([name, info]) => {
                  const count = typeof info?.count === "number" ? info.count : 0;
                  const error = info?.error;
                  return (
                    <div key={name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-foreground truncate">{name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs px-2 py-0.5">
                          {count}
                        </Badge>
                        {error && (
                          <span className="text-xs text-red-600 dark:text-red-400 max-w-[280px] truncate" title={error}>
                            {error}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Keine Objekte ermittelt.</p>
            )}
          </div>

          {result.raw_output && (
            <div className="flex items-center gap-2 pt-1">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    Raw Output anzeigen
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-[min(90vw,720px)] max-w-[min(90vw,820px)] p-0">
                  <ScrollArea className="max-h-[60vh]">
                    <pre className="whitespace-pre-wrap break-all text-left text-xs font-mono px-4 py-3">{result.raw_output}</pre>
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              <button
                type="button"
                onClick={() => downloadRawOutput(result.raw_output!, "Capability Discovery")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-transparent text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Raw Output herunterladen"
                title="Raw Output herunterladen"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderSystemDetails = (result: SystemDetectionResult | AuthFlowResult | null | undefined, title: string) => {
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

    // Check if it's an AuthFlowResult
    const isAuthFlow = Boolean(result && ("recommended_probe" in result || "authenticated" in result));

    const authResult = isAuthFlow ? (result as AuthFlowResult) : null;

    const renderStatusIcon = () => {
      if (isAuthFlow) {
        if (authResult?.authenticated === true) {
          return <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />;
        }

        if (authResult?.authenticated === false) {
          return <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />;
        }

        return <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />;
      }

      return (result as SystemDetectionResult).systemMatchesUrl ? (
        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
      ) : (
        <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
      );
    };

    return (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              {title}
              {renderStatusIcon()}
            </CardTitle>
            <button
              onClick={() => handleCopyResult(result, title)}
              className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="JSON kopieren"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Raw Output Tooltip */}
          {(isAuthFlow ? (result as AuthFlowResult).raw_output : (result as SystemDetectionResult).rawOutput) && (
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    Raw Output anzeigen
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  className="w-[min(90vw,520px)] max-w-[min(90vw,640px)] p-0"
                >
                  <ScrollArea className="max-h-[60vh]">
                    <pre className="whitespace-pre-wrap break-all text-left text-xs font-mono px-4 py-3">
                      {isAuthFlow ? (result as AuthFlowResult).raw_output : (result as SystemDetectionResult).rawOutput}
                    </pre>
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              <button
                type="button"
                onClick={() => downloadRawOutput((isAuthFlow ? (result as AuthFlowResult).raw_output : (result as SystemDetectionResult).rawOutput) || "", title)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-transparent text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Raw Output herunterladen"
                title="Raw Output herunterladen"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Auth Flow specific information */}
          {isAuthFlow && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge
                    variant={
                      authResult?.authenticated === true
                        ? "default"
                        : authResult?.authenticated === false
                          ? "destructive"
                          : "secondary"
                    }
                    className="text-sm"
                  >
                    {authResult?.authenticated === true
                      ? "Erfolgreich authentifiziert"
                      : authResult?.authenticated === false
                        ? "Authentifizierung fehlgeschlagen"
                        : "Noch kein Ergebnis"}
                  </Badge>
                </div>

                {authResult?.recommended_probe && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Probe</p>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary" className="text-xs uppercase tracking-wide">
                        {authResult.recommended_probe.method}
                      </Badge>
                      <span className="font-mono break-all text-xs sm:text-sm">{authResult.recommended_probe.url}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Auth erforderlich: {authResult.recommended_probe.requires_auth ? "Ja" : "Nein"}
                    </p>
                    {authResult.recommended_probe.api_format && (
                    <p className="text-xs text-muted-foreground">
                      API-Format:
                      {authResult.recommended_probe.api_format === "graphql"
                        ? " GraphQL"
                        : authResult.recommended_probe.api_format === "soap_xml" || authResult.recommended_probe.api_format === "xml"
                          ? " SOAP/XML"
                          : " REST/JSON"}
                    </p>
                  )}
                  {authResult.recommended_probe.auth_scheme && (
                    <p className="text-xs text-muted-foreground">
                      Authentifizierung:
                      {authResult.recommended_probe.auth_scheme === "bearer"
                        ? " Bearer"
                        : authResult.recommended_probe.auth_scheme === "basic"
                          ? " Basic"
                          : " Keine"}
                    </p>
                  )}
                  {authResult.recommended_probe.api_format === "graphql" && authResult.recommended_probe.graphql?.query && (
                    <div className="mt-1 space-y-1">
                      <p className="text-xs text-muted-foreground">GraphQL Query</p>
                        <pre className="whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 text-xs">
                          {authResult.recommended_probe.graphql.query}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {(authResult?.summary || authResult?.reasoning) && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Zusammenfassung</p>
                  <p className="text-sm leading-relaxed text-foreground">
                    {authResult?.summary || authResult?.reasoning}
                  </p>
                </div>
              )}

              {authResult?.probe_result && (
                <div className="space-y-3 p-3 rounded-md bg-muted/40">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">Probe-Ergebnis</p>
                    {typeof authResult.probe_result.status === "number" && (
                      <Badge
                        variant={
                          authResult.probe_result.status >= 200 && authResult.probe_result.status < 300
                            ? "default"
                            : "destructive"
                        }
                        className="text-xs"
                      >
                        Status {authResult.probe_result.status}
                      </Badge>
                    )}
                  </div>

                  {authResult.probe_result.error && (
                    <p className="text-xs text-destructive">{authResult.probe_result.error}</p>
                  )}

                  {authResult.probe_result.body && (
                    <pre className="whitespace-pre-wrap break-all text-xs font-mono bg-background/60 rounded-md p-2 border border-muted">
                      {typeof authResult.probe_result.body === "string"
                        ? authResult.probe_result.body
                        : JSON.stringify(authResult.probe_result.body, null, 2)}
                    </pre>
                  )}

                  {!authResult.probe_result.body && authResult.probe_result.raw_response && (
                    <pre className="whitespace-pre-wrap break-all text-xs font-mono bg-background/60 rounded-md p-2 border border-muted">
                      {authResult.probe_result.raw_response}
                    </pre>
                  )}

                  {authResult.probe_result.evidence && (
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <span className="font-medium text-foreground">Anfrage</span>
                        {authResult.probe_result.evidence.timestamp && typeof authResult.probe_result.evidence.timestamp === "string" && (
                          <span>{new Date(authResult.probe_result.evidence.timestamp).toLocaleString()}</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 font-mono">
                        {authResult.probe_result.evidence.method && typeof authResult.probe_result.evidence.method === "string" && (
                          <span>Method: {authResult.probe_result.evidence.method}</span>
                        )}
                        {authResult.probe_result.evidence.request_url && typeof authResult.probe_result.evidence.request_url === "string" && (
                          <span className="break-all">URL: {authResult.probe_result.evidence.request_url}</span>
                        )}
                        {authResult.probe_result.evidence.used_headers &&
                          Array.isArray(authResult.probe_result.evidence.used_headers) &&
                          authResult.probe_result.evidence.used_headers.length > 0 && (
                            <span>Headers: {authResult.probe_result.evidence.used_headers.join(", ")}</span>
                          )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {authResult?.error_message && (
                <div className="space-y-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                  <p className="text-xs text-muted-foreground">Fehler</p>
                  <p className="text-sm text-destructive">{authResult.error_message}</p>
                </div>
              )}
            </>
          )}

          {/* System Detection specific information */}
          {!isAuthFlow && (
            <>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Konfidenz</p>
                <div className="flex items-center gap-2">
                  <p className={cn("text-sm font-medium", getConfidenceColor((result as SystemDetectionResult).confidenceScore))}>
                    {(result as SystemDetectionResult).confidenceScore !== null
                      ? `${Math.round(((result as SystemDetectionResult).confidenceScore as number) * 100)}%`
                      : "Nicht verfügbar"}
                  </p>
                  {(result as SystemDetectionResult).confidenceScore !== null && (
                    <Badge variant={getConfidenceBadge((result as SystemDetectionResult).confidenceScore)} className="text-xs">
                      {(result as SystemDetectionResult).confidenceScore! >= 0.8 ? "Hoch" : (result as SystemDetectionResult).confidenceScore! >= 0.5 ? "Mittel" : "Niedrig"}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant={(result as SystemDetectionResult).systemMatchesUrl ? "default" : "destructive"}>
                  {(result as SystemDetectionResult).systemMatchesUrl ? "URL passt" : "Nicht erkannt"}
                </Badge>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">API-Typ</p>
                <p className="text-sm font-medium">
                  {(result as SystemDetectionResult).apiTypeDetected || (
                    <span className="text-muted-foreground italic">Nicht verfügbar</span>
                  )}
                </p>
              </div>

              {/* Additional System Information */}
              <div className="space-y-3">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">API-Subtyp</p>
                  <p className="text-sm font-medium">
                    {(result as SystemDetectionResult).apiSubtype || (
                      <span className="text-muted-foreground italic">Nicht verfügbar</span>
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Empfohlene Base URL</p>
                  <p className="text-sm font-medium break-all">
                    {(result as SystemDetectionResult).recommendedBaseUrl || (
                      <span className="text-muted-foreground italic">Nicht verfügbar</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Detection Evidence */}
              {(result as SystemDetectionResult).detectionEvidence && Object.keys((result as SystemDetectionResult).detectionEvidence as Record<string, unknown>).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground">Erkennungs-Details</p>
                  </div>
                  <div className="space-y-2">
                    {Object.entries((result as SystemDetectionResult).detectionEvidence as Record<string, unknown>).map(([key, value]) => {
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
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {schemaResult
        ? renderSchemaDetails(schemaResult)
        : (
          <>
            {renderSystemDetails(sourceResult, "Quellsystem")}
            {renderSystemDetails(targetResult, "Zielsystem")}
          </>
        )}
    </div>
  );
};

export default AgentOutputDisplay;