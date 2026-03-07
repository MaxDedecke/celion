import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import AgentOutputDisplay from "@/components/AgentOutputDisplay";
import type { AgentWorkflowStepState } from "./types";
import type {
  SystemDetectionResult,
  SystemDetectionStepResult,
  AuthFlowResult,
  AuthFlowStepResult,
  CapabilityDiscoveryResult,
} from "@/types/agents";

interface AgentResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: AgentWorkflowStepState | null;
  formattedResult: string | null;
  structuredResult:
    | SystemDetectionResult
    | SystemDetectionStepResult
    | AuthFlowResult
    | AuthFlowStepResult
    | CapabilityDiscoveryResult
    | null;
  sourceResult: SystemDetectionResult | AuthFlowResult | null;
  targetResult: SystemDetectionResult | AuthFlowResult | null;
  rawOutput?: string | null;
}

const AgentResultDialog = ({
  open,
  onOpenChange,
  step,
  formattedResult,
  structuredResult,
  sourceResult,
  targetResult,
  rawOutput,
}: AgentResultDialogProps) => {
  const { toast } = useToast();

  const isSchemaDiscoveryResult = (value: unknown): value is CapabilityDiscoveryResult => {
    return Boolean(
      value &&
        typeof value === "object" &&
        "objects" in (value as Record<string, unknown>),
    );
  };

  const schemaResult = structuredResult && isSchemaDiscoveryResult(structuredResult)
    ? structuredResult
    : null;

  const handleCopy = () => {
    const textToCopy = formattedResult || (structuredResult ? JSON.stringify(structuredResult, null, 2) : "");
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      toast({
        title: "Kopiert",
        description: "Ergebnis wurde in die Zwischenablage kopiert.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[98vw] sm:max-w-[92rem]">
        <DialogHeader className="px-8 flex flex-row items-center justify-between">
          <div className="space-y-1.5">
            <DialogTitle>Agenten-Output</DialogTitle>
            <DialogDescription className={cn(!step && "sr-only")}>
              {step ? `Schritt ${step.index + 1}: ${step.title}` : "Detaillierte Agenten-Ergebnisse"}
            </DialogDescription>
          </div>
          {(formattedResult || structuredResult) && (
            <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
              <Copy className="h-4 w-4" />
              JSON kopieren
            </Button>
          )}
        </DialogHeader>
        <ScrollArea className="max-h-[78vh] px-8 pb-2">
          {structuredResult ? (
            <AgentOutputDisplay
              sourceResult={schemaResult ? null : sourceResult}
              targetResult={schemaResult ? null : targetResult}
              schemaResult={schemaResult}
            />
          ) : formattedResult ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground p-4 rounded-md border border-border/60 bg-muted/40">
              {formattedResult}
            </pre>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">Für diesen Schritt wurde kein Agenten-Output gespeichert.</p>
          )}

          {rawOutput && (
            <div className="mt-6">
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      Gesamter Raw Output anzeigen
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-[min(90vw,720px)] max-w-[min(90vw,820px)] p-0">
                    <ScrollArea className="max-h-[60vh]">
                      <pre className="whitespace-pre-wrap break-all text-left text-xs font-mono px-4 py-3">{rawOutput}</pre>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default AgentResultDialog;
