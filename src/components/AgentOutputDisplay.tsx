import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { SystemDetectionResult, AuthFlowResult, SchemaDiscoveryResult } from "@/types/agents";
import { AlertCircle, CheckCircle2, Download, XCircle } from "lucide-react";

interface AgentOutputDisplayProps {
  sourceResult?: SystemDetectionResult | AuthFlowResult | null;
  targetResult?: SystemDetectionResult | AuthFlowResult | null;
  schemaResult?: SchemaDiscoveryResult | null;
}

const AgentOutputDisplay = ({ sourceResult, targetResult, schemaResult }: AgentOutputDisplayProps) => {
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

  const renderSchemaDetails = (result: SchemaDiscoveryResult | null | undefined) => {
    if (!result) {
      return (
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-lg">Schema Discovery</CardTitle>
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
            Schema Discovery
            {result.error_message ? (
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            )}
          </CardTitle>
          {result.summary && <p className="text-sm text-muted-foreground">{result.summary}</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          {result.objects.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Objekte gefunden.</p>
          ) : (
            <div className="space-y-3">
              {result.objects.map((object) => (
                <div
                  key={`${object.name}-${object.endpoint}`}
                  className="rounded-lg border border-border/60 bg-muted/40 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={object.success ? "secondary" : "destructive"} className="text-xs">
                        {object.success ? "Erfolgreich" : "Fehlgeschlagen"}
                      </Badge>
                      <span className="font-semibold text-sm">{object.name}</span>
                    </div>
                    <span className="text-xs font-mono break-all text-muted-foreground">{object.endpoint}</span>
                  </div>
                  {object.status !== undefined && object.status !== null && (
                    <p className="mt-1 text-xs text-muted-foreground">Status: {object.status}</p>
                  )}
                  {object.error && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{object.error}</p>
                  )}
                  {object.fields.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Felder ({object.fields.length})</p>
                      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                        {object.fields.map((field, index) => (
                          <div
                            key={`${object.name}-${field.name || index}`}
                            className="rounded-md border border-border/50 bg-background/60 px-2 py-1"
                          >
                            <p className="text-sm font-medium">{field.name || "Unbenannt"}</p>
                            {field.type && (
                              <p className="text-xs text-muted-foreground">Typ: {field.type}</p>
                            )}
                            {field.sample_value !== undefined && field.sample_value !== null && (
                              <p className="text-xs text-muted-foreground truncate">
                                Beispiel: {String(field.sample_value)}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
                onClick={() => downloadRawOutput(result.raw_output!, "Schema Discovery")}
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

      return (result as SystemDetectionResult).detected ? (
        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
      ) : (
        <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
      );
    };

    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {title}
            {renderStatusIcon()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Raw Output Tooltip */}
          {result.raw_output && (
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
                      {result.raw_output}
                    </pre>
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              <button
                type="button"
                onClick={() => downloadRawOutput(result.raw_output!, title)}
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
                        {authResult.probe_result.evidence.timestamp && (
                          <span>{new Date(authResult.probe_result.evidence.timestamp).toLocaleString()}</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 font-mono">
                        {authResult.probe_result.evidence.method && <span>Method: {authResult.probe_result.evidence.method}</span>}
                        {authResult.probe_result.evidence.request_url && (
                          <span className="break-all">URL: {authResult.probe_result.evidence.request_url}</span>
                        )}
                        {authResult.probe_result.evidence.used_headers &&
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
                  <p className={cn("text-sm font-medium", getConfidenceColor((result as SystemDetectionResult).confidence))}>
                    {(result as SystemDetectionResult).confidence !== null
                      ? `${Math.round(((result as SystemDetectionResult).confidence as number) * 100)}%`
                      : "Nicht verfügbar"}
                  </p>
                  {(result as SystemDetectionResult).confidence !== null && (
                    <Badge variant={getConfidenceBadge((result as SystemDetectionResult).confidence)} className="text-xs">
                      {(result as SystemDetectionResult).confidence! >= 0.8 ? "Hoch" : (result as SystemDetectionResult).confidence! >= 0.5 ? "Mittel" : "Niedrig"}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant={(result as SystemDetectionResult).detected ? "default" : "destructive"}>
                  {(result as SystemDetectionResult).detected ? "Erkannt" : "Nicht erkannt"}
                </Badge>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">System</p>
                <p className="text-sm font-medium">
                  {(result as SystemDetectionResult).system || (
                    <span className="text-muted-foreground italic">Nicht verfügbar</span>
                  )}
                </p>
              </div>

              {/* Additional System Information */}
              <div className="space-y-3">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">API Version</p>
                  <p className="text-sm font-medium">
                    {(result as SystemDetectionResult).api_version || (
                      <span className="text-muted-foreground italic">Nicht verfügbar</span>
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Base URL</p>
                  <p className="text-sm font-medium break-all">
                    {(result as SystemDetectionResult).base_url || (
                      <span className="text-muted-foreground italic">Nicht verfügbar</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Detection Evidence */}
              {(result as SystemDetectionResult).detection_evidence && Object.keys((result as SystemDetectionResult).detection_evidence).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground">Erkennungs-Details</p>
                  </div>
                  <div className="space-y-2">
                    {Object.entries((result as SystemDetectionResult).detection_evidence).map(([key, value]) => {
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
