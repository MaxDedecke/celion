import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import AgentOutputDisplay from "@/components/AgentOutputDisplay";
import type { AgentWorkflowStepState } from "./types";
import type { SystemDetectionResult, SystemDetectionStepResult } from "@/types/agents";

interface AgentResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: AgentWorkflowStepState | null;
  formattedResult: string | null;
  structuredResult: SystemDetectionResult | SystemDetectionStepResult | null;
  sourceResult: SystemDetectionResult | null;
  targetResult: SystemDetectionResult | null;
}

const AgentResultDialog = ({
  open,
  onOpenChange,
  step,
  formattedResult,
  structuredResult,
  sourceResult,
  targetResult,
}: AgentResultDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[98vw] sm:max-w-[92rem]">
        <DialogHeader className="px-8">
          <DialogTitle>Agenten-Output</DialogTitle>
          {step && (
            <DialogDescription>
              Schritt {step.index + 1}: {step.title}
            </DialogDescription>
          )}
        </DialogHeader>
        <ScrollArea className="max-h-[78vh] px-8 pb-2">
          {structuredResult ? (
            <AgentOutputDisplay sourceResult={sourceResult} targetResult={targetResult} />
          ) : formattedResult ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground p-4 rounded-md border border-border/60 bg-muted/40">
              {formattedResult}
            </pre>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">Für diesen Schritt wurde kein Agenten-Output gespeichert.</p>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default AgentResultDialog;
