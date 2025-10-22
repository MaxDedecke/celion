import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Puzzle, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";

interface Field {
  id: string;
  name: string;
  type?: string;
}

interface FieldMapping {
  sourceFieldId: string;
  targetFieldId: string;
}

interface FieldMapperProps {
  sourceSystem: string;
  targetSystem: string;
  sourceObject: string;
  targetObject: string;
}

// Define fields for different object types
const objectFields: Record<string, Field[]> = {
  // Asana
  "asana-task": [
    { id: "title", name: "Title", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "status", name: "Status", type: "enum" },
    { id: "tags", name: "Tags", type: "array" },
  ],
  "asana-project": [
    { id: "name", name: "Name", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "owner", name: "Owner", type: "user" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "status", name: "Status", type: "enum" },
  ],
  
  // Jira
  "jira-issue": [
    { id: "summary", name: "Summary", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "reporter", name: "Reporter", type: "user" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "status", name: "Status", type: "enum" },
    { id: "labels", name: "Labels", type: "array" },
  ],
  "jira-task": [
    { id: "summary", name: "Summary", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "status", name: "Status", type: "enum" },
  ],
  "jira-epic": [
    { id: "summary", name: "Summary", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "startDate", name: "Start Date", type: "date" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "owner", name: "Owner", type: "user" },
  ],
  
  // Azure DevOps
  "azure-user-story": [
    { id: "title", name: "Title", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignedTo", name: "Assigned To", type: "user" },
    { id: "state", name: "State", type: "enum" },
    { id: "priority", name: "Priority", type: "enum" },
  ],
  
  // Monday.com
  "monday-item": [
    { id: "name", name: "Name", type: "text" },
    { id: "status", name: "Status", type: "enum" },
    { id: "person", name: "Person", type: "user" },
    { id: "date", name: "Date", type: "date" },
    { id: "priority", name: "Priority", type: "enum" },
  ],
  
  // Trello
  "trello-card": [
    { id: "name", name: "Name", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "members", name: "Members", type: "array" },
    { id: "labels", name: "Labels", type: "array" },
  ],
};

const getFieldsForObject = (system: string, objectType: string): Field[] => {
  const systemPrefix = system.toLowerCase().split(" ")[0];
  const key = `${systemPrefix}-${objectType}`;
  return objectFields[key] || [];
};

export const FieldMapper = ({ sourceSystem, targetSystem, sourceObject, targetObject }: FieldMapperProps) => {
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [draggedField, setDraggedField] = useState<{ side: 'source' | 'target', fieldId: string } | null>(null);
  const [hoveredField, setHoveredField] = useState<string | null>(null);

  const sourceFields = getFieldsForObject(sourceSystem, sourceObject);
  const targetFields = getFieldsForObject(targetSystem, targetObject);

  const handleDragStart = (side: 'source' | 'target', fieldId: string) => {
    setDraggedField({ side, fieldId });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (side: 'source' | 'target', fieldId: string) => {
    if (!draggedField) return;
    
    // Only allow mapping from source to target or target to source
    if (draggedField.side === side) {
      setDraggedField(null);
      return;
    }

    const sourceFieldId = draggedField.side === 'source' ? draggedField.fieldId : fieldId;
    const targetFieldId = draggedField.side === 'target' ? draggedField.fieldId : fieldId;

    // Check if mapping already exists
    const existingMapping = mappings.find(
      m => m.sourceFieldId === sourceFieldId || m.targetFieldId === targetFieldId
    );

    if (existingMapping) {
      // Remove existing mapping and add new one
      setMappings(prev => [
        ...prev.filter(m => m.sourceFieldId !== sourceFieldId && m.targetFieldId !== targetFieldId),
        { sourceFieldId, targetFieldId }
      ]);
    } else {
      setMappings(prev => [...prev, { sourceFieldId, targetFieldId }]);
    }

    setDraggedField(null);
    setHoveredField(null);
  };

  const handleQuickMap = (sourceFieldId: string, targetFieldId: string) => {
    const existingMapping = mappings.find(
      m => m.sourceFieldId === sourceFieldId || m.targetFieldId === targetFieldId
    );

    if (existingMapping) {
      setMappings(prev => [
        ...prev.filter(m => m.sourceFieldId !== sourceFieldId && m.targetFieldId !== targetFieldId),
        { sourceFieldId, targetFieldId }
      ]);
    } else {
      setMappings(prev => [...prev, { sourceFieldId, targetFieldId }]);
    }
  };

  const isMapped = (side: 'source' | 'target', fieldId: string) => {
    return mappings.some(m => 
      side === 'source' ? m.sourceFieldId === fieldId : m.targetFieldId === fieldId
    );
  };

  const getMappedField = (side: 'source' | 'target', fieldId: string) => {
    const mapping = mappings.find(m => 
      side === 'source' ? m.sourceFieldId === fieldId : m.targetFieldId === fieldId
    );
    if (!mapping) return null;
    return side === 'source' ? mapping.targetFieldId : mapping.sourceFieldId;
  };

  const removeMapping = (sourceFieldId: string) => {
    setMappings(prev => prev.filter(m => m.sourceFieldId !== sourceFieldId));
  };

  return (
    <div className="grid grid-cols-2 gap-8 relative">
      {/* Source System Block */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {sourceSystem} {sourceObject}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {sourceFields.map((field) => {
            const mappedTargetId = getMappedField('source', field.id);
            const mappedTarget = targetFields.find(f => f.id === mappedTargetId);
            
            return (
              <div
                key={field.id}
                draggable
                onDragStart={() => handleDragStart('source', field.id)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop('source', field.id)}
                onMouseEnter={() => setHoveredField(field.id)}
                onMouseLeave={() => setHoveredField(null)}
                className={`
                  flex items-center justify-between gap-2 p-3 rounded-lg border
                  ${isMapped('source', field.id) 
                    ? 'bg-primary/10 border-primary' 
                    : 'bg-muted/50 border-border'
                  }
                  ${hoveredField === field.id ? 'ring-2 ring-primary/50' : ''}
                  cursor-grab active:cursor-grabbing transition-all
                  hover:shadow-md
                `}
              >
                <div className="flex items-center gap-2 flex-1">
                  <Puzzle className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{field.name}</span>
                </div>
                
                {isMapped('source', field.id) && mappedTarget && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ArrowRight className="h-3 w-3" />
                    <span>{mappedTarget.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeMapping(field.id);
                      }}
                    >
                      ×
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Target System Block */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {targetSystem} {targetObject}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {targetFields.map((field) => {
            const mappedSourceId = getMappedField('target', field.id);
            const mappedSource = sourceFields.find(f => f.id === mappedSourceId);
            
            return (
              <div
                key={field.id}
                draggable
                onDragStart={() => handleDragStart('target', field.id)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop('target', field.id)}
                onMouseEnter={() => setHoveredField(field.id)}
                onMouseLeave={() => setHoveredField(null)}
                className={`
                  flex items-center justify-between gap-2 p-3 rounded-lg border
                  ${isMapped('target', field.id) 
                    ? 'bg-primary/10 border-primary' 
                    : 'bg-muted/50 border-border'
                  }
                  ${hoveredField === field.id ? 'ring-2 ring-primary/50' : ''}
                  cursor-grab active:cursor-grabbing transition-all
                  hover:shadow-md
                `}
              >
                <div className="flex items-center gap-2 flex-1">
                  <Puzzle className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{field.name}</span>
                </div>
                
                {isMapped('target', field.id) && mappedSource && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{mappedSource.name}</span>
                    <ArrowRight className="h-3 w-3" />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Mapping Summary */}
      <div className="col-span-2 mt-4">
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-sm">Mapped Fields ({mappings.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {mappings.map((mapping, index) => {
                const sourceField = sourceFields.find(f => f.id === mapping.sourceFieldId);
                const targetField = targetFields.find(f => f.id === mapping.targetFieldId);
                
                return (
                  <div 
                    key={index}
                    className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full text-xs border border-primary/30"
                  >
                    <span>{sourceField?.name}</span>
                    <ArrowRight className="h-3 w-3" />
                    <span>{targetField?.name}</span>
                    <button
                      onClick={() => removeMapping(mapping.sourceFieldId)}
                      className="ml-1 hover:text-destructive"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
