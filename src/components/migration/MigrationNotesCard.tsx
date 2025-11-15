import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

interface MigrationNotesCardProps {
  notes: string;
  onNotesChange: (value: string) => void;
  onSave: () => void;
  isDirty: boolean;
  isSaving: boolean;
}

const MigrationNotesCard = ({ notes, onNotesChange, onSave, isDirty, isSaving }: MigrationNotesCardProps) => {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Anmerkungen</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col gap-3">
          <Textarea
            id="migration-notes"
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Beschreibe hier dein Prompt: Ziel der Migration, relevante Randbedingungen und gewünschte Unterstützung."
            rows={6}
            className="min-h-[120px]"
          />
          <Button onClick={onSave} disabled={!isDirty || isSaving} size="sm" className="self-end">
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Speichern
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default MigrationNotesCard;
