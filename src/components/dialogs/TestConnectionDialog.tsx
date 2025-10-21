import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

interface TestConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectorType: 'in' | 'out';
  onTestComplete: () => void;
}

const TestConnectionDialog = ({ 
  open, 
  onOpenChange, 
  connectorType,
  onTestComplete 
}: TestConnectionDialogProps) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (open) {
      setProgress(0);
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => {
              onTestComplete();
              onOpenChange(false);
            }, 500);
            return 100;
          }
          return prev + 5;
        });
      }, 100);

      return () => clearInterval(interval);
    }
  }, [open, onOpenChange, onTestComplete]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {connectorType === 'in' ? 'Inconnector' : 'Outconnector'} wird getestet
          </DialogTitle>
          <DialogDescription>
            Verbindung wird überprüft und Objekte werden gezählt...
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <Progress value={progress} />
          <p className="text-center text-sm text-muted-foreground">
            {progress}% abgeschlossen
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TestConnectionDialog;
