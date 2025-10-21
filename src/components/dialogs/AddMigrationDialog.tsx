import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

interface AddMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string) => void;
}

const AddMigrationDialog = ({ open, onOpenChange, onAdd }: AddMigrationDialogProps) => {
  const [name, setName] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError(true);
      return;
    }
    onAdd(name);
    setName("");
    setError(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Add new migration</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Input
              placeholder="Name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(false);
              }}
              className="bg-input border-border"
            />
            {error && (
              <div className="flex items-center gap-2 mt-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>The name is not final</span>
              </div>
            )}
          </div>
          <Button
            onClick={handleSubmit}
            className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground"
          >
            Start process
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddMigrationDialog;
