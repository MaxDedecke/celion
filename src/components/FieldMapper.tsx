import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Puzzle,
  ArrowRight,
  Wand2,
  Maximize2,
  Minimize2,
  Info,
  Edit3,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import type { FieldMapping, MappingType } from "@/types/mapping";
import type { SchemaField } from "@/types/schema";
import { getFieldsForSystemObject, getSystemObjectOptions } from "@/lib/schema-registry";
import {
  createMappingId,
  loadMappingsFromDatabase,
  saveMappingToDatabase,
  deleteMappingFromDatabase,
  loadAllMappingsForSource,
} from "@/lib/mapping-storage";

type Field = SchemaField;

interface FieldMapperProps {
  pipelineId: string;
  sourceSystem: string;
  targetSystem: string;
  sourceObject: string;
  targetObject: string;
}

export const FieldMapper = ({ pipelineId, sourceSystem, targetSystem, sourceObject, targetObject }: FieldMapperProps) => {
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [savedMappings, setSavedMappings] = useState<FieldMapping[]>([]);
  const [allSourceMappings, setAllSourceMappings] = useState<(FieldMapping & { targetObjectType: string })[]>([]);
  const [draggedField, setDraggedField] = useState<{ side: 'source' | 'target', fieldId: string } | null>(null);
  const [hoveredField, setHoveredField] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [draftMapping, setDraftMapping] = useState<FieldMapping | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Lock background scroll while in fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isFullscreen]);

  const sourceFields = useMemo(
    () => getFieldsForSystemObject(sourceSystem, sourceObject),
    [sourceSystem, sourceObject]
  );
  const targetFields = useMemo(
    () => getFieldsForSystemObject(targetSystem, targetObject),
    [targetSystem, targetObject]
  );

  const sourceObjectDisplayName = useMemo(() => {
    const options = getSystemObjectOptions(sourceSystem);
    return options.find((option) => option.id === sourceObject)?.name ?? sourceObject;
  }, [sourceSystem, sourceObject]);

  const targetObjectOptions = useMemo(
    () => getSystemObjectOptions(targetSystem),
    [targetSystem]
  );

  const targetObjectDisplayName = useMemo(() => {
    return targetObjectOptions.find((option) => option.id === targetObject)?.name ?? targetObject;
  }, [targetObjectOptions, targetObject]);

  const getTargetObjectDisplayName = useCallback(
    (objectType: string) => {
      return targetObjectOptions.find((option) => option.id === objectType)?.name ?? objectType;
    },
    [targetObjectOptions]
  );

  const getTargetFieldName = useCallback(
    (objectType: string, fieldId: string) => {
      const objectFields = getFieldsForSystemObject(targetSystem, objectType);
      return objectFields.find((field) => field.id === fieldId)?.name ?? fieldId;
    },
    [targetSystem]
  );

  const createDirectMapping = useCallback(
    (sourceFieldId: string, targetFieldId: string): FieldMapping => ({
      id: createMappingId(),
      sourceFieldId,
      targetFieldId,
      mappingType: "direct",
      updatedAt: new Date().toISOString(),
    }),
    []
  );

  const updateMappingEntry = useCallback((updated: FieldMapping) => {
    setMappings((prev) =>
      prev.map((mapping) =>
        mapping.id === updated.id
          ? { ...updated, updatedAt: new Date().toISOString() }
          : mapping
      )
    );
  }, []);

  const getMappingsForField = useCallback(
    (side: 'source' | 'target', fieldId: string): FieldMapping[] => {
      return mappings.filter((mapping) =>
        side === 'source'
          ? mapping.sourceFieldId === fieldId
          : mapping.targetFieldId === fieldId
      );
    },
    [mappings]
  );

  // Get all mappings for a source field (across all target objects)
  const getAllMappingsForSourceField = useCallback(
    (fieldId: string): (FieldMapping & { targetObjectType: string })[] => {
      return allSourceMappings.filter((mapping) => mapping.sourceFieldId === fieldId);
    },
    [allSourceMappings]
  );

  const otherTargetMappings = useMemo(() => {
    return allSourceMappings
      .filter((mapping) => mapping.targetObjectType !== targetObject)
      .reduce((acc, mapping) => {
        const current = acc[mapping.targetObjectType] ?? [];
        acc[mapping.targetObjectType] = [...current, mapping];
        return acc;
      }, {} as Record<string, (FieldMapping & { targetObjectType: string })[]>);
  }, [allSourceMappings, targetObject]);

  const otherTargetMappingCount = useMemo(() => {
    return Object.values(otherTargetMappings).reduce((sum, mappingsForObject) => sum + mappingsForObject.length, 0);
  }, [otherTargetMappings]);

  const totalMappingCount = mappings.length + otherTargetMappingCount;

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(mappings) !== JSON.stringify(savedMappings);
  }, [mappings, savedMappings]);

  // Load mappings from database
  useEffect(() => {
    const loadMappings = async () => {
      setIsLoading(true);
      // Load mappings for current target object
      const loadedMappings = await loadMappingsFromDatabase(pipelineId, sourceObject, targetObject);
      setMappings(loadedMappings);
      setSavedMappings(loadedMappings);
      
      // Load all mappings for the source object (across all target objects)
      const allMappings = await loadAllMappingsForSource(pipelineId, sourceObject);
      setAllSourceMappings(allMappings);
      
      setIsLoading(false);
    };

    loadMappings();
  }, [pipelineId, sourceObject, targetObject]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Auto-map fields with exact matching names
  const handleAutoMap = () => {
    const newMappings: FieldMapping[] = [];

    sourceFields.forEach(sourceField => {
      const matchingTargetField = targetFields.find(
        targetField => targetField.name.toLowerCase() === sourceField.name.toLowerCase()
      );

      if (matchingTargetField) {
        // Check if this exact mapping already exists
        const exists = mappings.some(
          m =>
            m.mappingType === "direct" &&
            m.targetFieldId === matchingTargetField.id &&
            m.sourceFieldId === sourceField.id
        );
        if (!exists) {
          newMappings.push(createDirectMapping(sourceField.id, matchingTargetField.id));
        }
      }
    });

    if (newMappings.length > 0) {
      setMappings(prev => [...prev, ...newMappings]);
      toast.info(`${newMappings.length} Feld${newMappings.length > 1 ? 'er' : ''} automatisch gemappt (noch nicht gespeichert)`);
    } else {
      toast.info("Keine passenden Felder gefunden");
    }
  };

  // Check if field is involved in hover highlighting
  const isHighlighted = (side: 'source' | 'target', fieldId: string): boolean => {
    if (!hoveredField) return false;

    // If this field is hovered
    if (hoveredField === fieldId) return true;

    // Check if this field is connected to the hovered field
    const hoveredAsSource = mappings.filter(m => m.sourceFieldId === hoveredField);
    const hoveredAsTarget = mappings.filter(m => m.targetFieldId === hoveredField);

    if (hoveredAsSource.length > 0) {
      if (side === 'target') {
        return hoveredAsSource.some(m => m.targetFieldId === fieldId);
      }

      return hoveredField === fieldId;
    }

    if (hoveredAsTarget.length > 0) {
      if (side === 'source') {
        return hoveredAsTarget.some(m => m.sourceFieldId === fieldId);
      }

      return hoveredField === fieldId;
    }

    return false;
  };

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

    const directMapping = mappings.find(
      m =>
        m.mappingType === "direct" &&
        m.targetFieldId === targetFieldId &&
        m.sourceFieldId === sourceFieldId
    );

    if (directMapping) {
      setMappings(prev => prev.filter(m => m.id !== directMapping.id));
      toast.info("Mapping entfernt (noch nicht gespeichert)");
    } else {
      const newMapping = createDirectMapping(sourceFieldId, targetFieldId);
      setMappings(prev => [...prev, newMapping]);
      toast.success("Mapping hinzugefügt (noch nicht gespeichert)");
    }

    setDraggedField(null);
  };

  const handleRemoveMapping = (mappingId: string) => {
    setMappings(prev => prev.filter(m => m.id !== mappingId));
  };

  const openMappingEditor = (mapping: FieldMapping) => {
    setEditingMappingId(mapping.id);
    setDraftMapping({ ...mapping });
    setIsMappingModalOpen(true);
  };

  const closeMappingEditor = () => {
    setIsMappingModalOpen(false);
    setEditingMappingId(null);
    setDraftMapping(null);
  };

  const defaultJoinWith = ", ";

  const collectionCandidates = useMemo(
    () => sourceFields.filter((field) => field.type === "array" && field.children?.length),
    [sourceFields]
  );

  const selectedCollectionField = useMemo(() => {
    if (!draftMapping || draftMapping.mappingType !== "collection") {
      return undefined;
    }

    return collectionCandidates.find((field) => field.id === draftMapping.sourceFieldId);
  }, [draftMapping, collectionCandidates]);

  const handleMappingTypeChange = (value: MappingType) => {
    if (value === "collection" && collectionCandidates.length === 0) {
      toast.error("Für dieses Objekt stehen keine Sammlungsfelder zur Verfügung.");
      return;
    }

    setDraftMapping((prev) => {
      if (!prev) return prev;

      if (value === "direct") {
        return {
          id: prev.id,
          mappingType: "direct",
          sourceFieldId: prev.sourceFieldId,
          targetFieldId: prev.targetFieldId,
          description: prev.description,
          updatedAt: prev.updatedAt,
        };
      }

      const previousChildId = prev.mappingType === "collection" ? prev.collectionItemFieldId : undefined;
      const fallbackField =
        collectionCandidates.find((field) => field.id === prev.sourceFieldId) ??
        collectionCandidates[0];

      if (!fallbackField) {
        return prev;
      }

      const fallbackChild =
        fallbackField.children?.find((child) => child.id === previousChildId) ??
        fallbackField.children?.[0];

      return {
        id: prev.id,
        mappingType: "collection",
        sourceFieldId: fallbackField.id,
        targetFieldId: prev.targetFieldId,
        description: prev.description,
        updatedAt: prev.updatedAt,
        collectionItemFieldId: fallbackChild?.id ?? "",
        joinWith: prev.mappingType === "collection" ? prev.joinWith ?? defaultJoinWith : defaultJoinWith,
      };
    });
  };

  const handleDirectSourceChange = (fieldId: string) => {
    setDraftMapping((prev) => {
      if (!prev || prev.mappingType !== "direct") return prev;

      return { ...prev, sourceFieldId: fieldId };
    });
  };

  const handleCollectionFieldChange = (fieldId: string) => {
    setDraftMapping((prev) => {
      if (!prev || prev.mappingType !== "collection") return prev;

      const field = collectionCandidates.find((candidate) => candidate.id === fieldId);
      if (!field) {
        return prev;
      }

      const nextChild = field.children?.[0];

      return {
        ...prev,
        sourceFieldId: field.id,
        collectionItemFieldId: nextChild?.id ?? "",
      };
    });
  };

  const handleCollectionItemFieldChange = (fieldId: string) => {
    setDraftMapping((prev) => {
      if (!prev || prev.mappingType !== "collection") return prev;

      return {
        ...prev,
        collectionItemFieldId: fieldId,
      };
    });
  };

  const handleJoinWithChange = (value: string) => {
    setDraftMapping((prev) => {
      if (!prev || prev.mappingType !== "collection") return prev;

      return {
        ...prev,
        joinWith: value,
      };
    });
  };

  const handleSaveMappingDetails = () => {
    if (!draftMapping) return;

    if (draftMapping.mappingType === "direct") {
      if (!draftMapping.sourceFieldId) {
        toast.error("Bitte ein Quellfeld auswählen.");
        return;
      }

      updateMappingEntry(draftMapping);
      toast.success("Mapping aktualisiert (noch nicht gespeichert)");
      closeMappingEditor();
      return;
    }

    if (!draftMapping.sourceFieldId) {
      toast.error("Bitte eine Sammlung auswählen.");
      return;
    }

    if (!draftMapping.collectionItemFieldId) {
      toast.error("Bitte ein Feld innerhalb der Sammlung wählen.");
      return;
    }

    const sanitizedJoin = draftMapping.joinWith && draftMapping.joinWith.length > 0
      ? draftMapping.joinWith
      : defaultJoinWith;

    const updatedMapping: FieldMapping = {
      ...draftMapping,
      joinWith: sanitizedJoin,
    };

    updateMappingEntry(updatedMapping);
    toast.success("Mapping aktualisiert (noch nicht gespeichert)");
    closeMappingEditor();
  };

  const getSourceFieldName = useCallback(
    (fieldId: string) => sourceFields.find((field) => field.id === fieldId)?.name ?? fieldId,
    [sourceFields]
  );

  const getCollectionItemName = useCallback(
    (collectionId: string, childId: string) => {
      const collectionField = sourceFields.find((field) => field.id === collectionId);
      return collectionField?.children?.find((child) => child.id === childId)?.name ?? childId;
    },
    [sourceFields]
  );

  const describeMappingSource = useCallback(
    (mapping: FieldMapping) => {
      if (mapping.mappingType === "direct") {
        return getSourceFieldName(mapping.sourceFieldId);
      }

      const baseName = getSourceFieldName(mapping.sourceFieldId);
      const childName = getCollectionItemName(mapping.sourceFieldId, mapping.collectionItemFieldId);
      return `${baseName}[].${childName}`;
    },
    [getSourceFieldName, getCollectionItemName]
  );

  const getMappingTypeLabel = (mapping: FieldMapping) =>
    mapping.mappingType === "direct" ? "Direkt" : "Sammlung";

  const getMappingTypeTooltip = (mapping: FieldMapping) =>
    mapping.mappingType === "direct"
      ? "1:1 Zuordnung ohne zusätzliche Verarbeitung"
      : "Werte aus einer Sammlung sammeln und zusammenführen";

  const isMapped = (side: 'source' | 'target', fieldId: string) => {
    return getMappingsForField(side, fieldId).length > 0;
  };

  const handleSaveAllMappings = async () => {
    setIsSaving(true);
    try {
      // Get IDs of mappings to keep
      const currentMappingIds = new Set(mappings.map(m => m.id));
      const savedMappingIds = new Set(savedMappings.map(m => m.id));

      // Delete removed mappings
      const toDelete = savedMappings.filter(m => !currentMappingIds.has(m.id));
      for (const mapping of toDelete) {
        await deleteMappingFromDatabase(mapping.id);
      }

      // Save new and updated mappings
      for (const mapping of mappings) {
        await saveMappingToDatabase(pipelineId, mapping, sourceObject, targetObject);
      }

      setSavedMappings([...mappings]);
      
      // Reload all source mappings to update the overview
      const allMappings = await loadAllMappingsForSource(pipelineId, sourceObject);
      setAllSourceMappings(allMappings);
      
      toast.success("Alle Mappings erfolgreich gespeichert");
    } catch (error) {
      console.error("Error saving mappings:", error);
      toast.error("Fehler beim Speichern der Mappings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscardChanges = () => {
    setMappings([...savedMappings]);
    setShowUnsavedDialog(false);
    setPendingAction(null);
    toast.info("Änderungen verworfen");
  };

  const handleConfirmUnsavedDialog = async () => {
    await handleSaveAllMappings();
    setShowUnsavedDialog(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const content = (
    <TooltipProvider>
      <div
        className={`${
          isFullscreen
            ? 'fixed inset-0 z-40 bg-background p-6 overflow-auto'
            : ''
        } flex flex-col space-y-4`}
      >
        {/* Header with Auto-Map, Save and Fullscreen Buttons */}
        <div className="flex justify-between items-center mb-4">
          {isFullscreen && (
            <h2 className="text-lg font-semibold">
              Field Mapping: {sourceSystem} {sourceObject} → {targetSystem} {targetObject}
            </h2>
          )}
          <div className={`flex gap-2 ${isFullscreen ? 'ml-auto' : 'ml-auto'}`}>
            <Button
              onClick={handleAutoMap}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <Wand2 className="h-4 w-4" />
              Auto Map
            </Button>
            <Button
              onClick={handleSaveAllMappings}
              variant={hasUnsavedChanges ? "default" : "outline"}
              size="sm"
              className="gap-2"
              disabled={isSaving || !hasUnsavedChanges}
            >
              <Save className="h-4 w-4" />
              {isSaving ? "Speichert..." : hasUnsavedChanges ? "Speichern *" : "Gespeichert"}
            </Button>
            <Button
              onClick={() => setIsFullscreen(!isFullscreen)}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="h-4 w-4" />
                  Exit Fullscreen
                </>
              ) : (
                <>
                  <Maximize2 className="h-4 w-4" />
                  Fullscreen
                </>
              )}
            </Button>
          </div>
        </div>

        <div className={`grid grid-cols-2 gap-8 relative ${isFullscreen ? 'flex-1' : ''}`}>
          {/* Source System Block */}
          <Card className="bg-transparent border-border h-full">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                {sourceSystem} {sourceObject}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sourceFields.map((field) => {
                const fieldMappings = getMappingsForField('source', field.id);
                const allFieldMappings = getAllMappingsForSourceField(field.id);
                const otherObjectMappings = allFieldMappings.filter(m => m.targetObjectType !== targetObject);
                const highlighted = isHighlighted('source', field.id);

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
                      flex flex-col gap-2 p-3 rounded-lg border
                      ${isMapped('source', field.id)
                        ? 'bg-primary/10 border-primary'
                        : 'bg-muted/50 border-border'
                      }
                      ${highlighted ? 'bg-purple-200/40 border-purple-400 dark:bg-purple-900/30 dark:border-purple-600' : ''}
                      cursor-grab active:cursor-grabbing transition-all
                      hover:shadow-md
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <Puzzle className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{field.name}</span>
                    </div>

                    {fieldMappings.length > 0 && (
                      <div className="flex flex-col gap-1 pl-6">
                        {fieldMappings.map((mapping) => {
                          const target = targetFields.find(f => f.id === mapping.targetFieldId);
                          const badgeVariant = mapping.mappingType === 'collection' ? 'secondary' : 'outline';

                          return (
                            <div
                              key={mapping.id}
                              className="flex items-center gap-2 text-xs text-muted-foreground"
                            >
                              <ArrowRight className="h-3 w-3" />
                              <span className="text-xs font-medium text-muted-foreground">
                                {targetObjectDisplayName}
                              </span>
                              <span className="text-xs text-muted-foreground">·</span>
                              <span>{target?.name ?? mapping.targetFieldId}</span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant={badgeVariant} className="flex items-center gap-1">
                                    {getMappingTypeLabel(mapping)}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>{getMappingTypeTooltip(mapping)}</TooltipContent>
                              </Tooltip>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openMappingEditor(mapping);
                                }}
                              >
                                <Edit3 className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveMapping(mapping.id);
                                }}
                              >
                                ×
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    
                    {/* Show mappings to other target objects */}
                    {otherObjectMappings.length > 0 && (
                      <div className="flex flex-col gap-1 pl-6 pt-1 border-t border-border/50">
                        <div className="text-xs text-muted-foreground/60 mb-1">Weitere Mappings:</div>
                        {otherObjectMappings.map((mapping) => {
                          const targetObjDisplayName = getTargetObjectDisplayName(mapping.targetObjectType);
                          const badgeVariant = mapping.mappingType === 'collection' ? 'secondary' : 'outline';

                          return (
                            <div
                              key={mapping.id}
                              className="flex items-center gap-2 text-xs text-muted-foreground/70"
                            >
                              <ArrowRight className="h-3 w-3" />
                              <span className="text-xs font-medium">
                                {targetObjDisplayName}
                              </span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant={badgeVariant} className="flex items-center gap-1 opacity-70">
                                    {getMappingTypeLabel(mapping)}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="space-y-1">
                                    <div>{getMappingTypeTooltip(mapping)}</div>
                                    <div className="text-xs text-muted-foreground">
                                      Zum Bearbeiten zu {targetObjDisplayName} wechseln
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Target System Block */}
          <Card className="bg-transparent border-border h-full">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                {targetSystem} {targetObject}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {targetFields.map((field) => {
                const fieldMappings = getMappingsForField('target', field.id);
                const highlighted = isHighlighted('target', field.id);

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
                      flex flex-col gap-2 p-3 rounded-lg border
                      ${isMapped('target', field.id)
                        ? 'bg-primary/10 border-primary'
                        : 'bg-muted/50 border-border'
                      }
                      ${highlighted ? 'bg-purple-200/40 border-purple-400 dark:bg-purple-900/30 dark:border-purple-600' : ''}
                      cursor-grab active:cursor-grabbing transition-all
                      hover:shadow-md
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <Puzzle className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{field.name}</span>
                    </div>

                    {fieldMappings.length > 0 && (
                      <div className="flex flex-col gap-1 pl-6">
                        {fieldMappings.map((mapping) => {
                          const sourceLabel = describeMappingSource(mapping);
                          const badgeVariant = mapping.mappingType === 'collection' ? 'secondary' : 'outline';
                          const joinDescription =
                            mapping.mappingType === 'collection' && mapping.joinWith
                              ? ` (Trenner: "${mapping.joinWith}")`
                              : '';

                          return (
                            <div
                              key={mapping.id}
                              className="flex items-center gap-2 text-xs text-muted-foreground"
                            >
                              <div className="flex items-center gap-1">
                                <span className="font-medium text-muted-foreground">
                                  {sourceObjectDisplayName}
                                </span>
                                <span className="text-muted-foreground">·</span>
                                <span>
                                  {sourceLabel}
                                  {joinDescription}
                                </span>
                              </div>
                              <ArrowRight className="h-3 w-3" />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant={badgeVariant} className="flex items-center gap-1">
                                    {getMappingTypeLabel(mapping)}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>{getMappingTypeTooltip(mapping)}</TooltipContent>
                              </Tooltip>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openMappingEditor(mapping);
                                }}
                              >
                                <Edit3 className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveMapping(mapping.id);
                                }}
                              >
                                ×
                              </Button>
                            </div>
                          );
                        })}
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
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  Mapping-Übersicht ({totalMappingCount})
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground"
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Kombiniere direkte Feldzuordnungen mit Sammlungs-Mappings. Wähle Sammlungen, um Werte aus
                      verschachtelten Datensätzen zusammenzuführen und z. B. Listen von IDs in ein Textfeld zu schreiben.
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {totalMappingCount === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Noch keine Felder gemappt. Ziehe Felder oder verwende "Auto Map", um zu starten.
                  </p>
                ) : (
                  <div className="space-y-6">
                    {mappings.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-primary font-semibold">
                          <span>Aktuelles Zielobjekt · {targetObjectDisplayName}</span>
                          <Badge variant="outline" className="border-primary/60 bg-primary/10 text-primary">
                            Aktive Auswahl
                          </Badge>
                        </div>
                        {mappings.map((mapping) => {
                          const targetName = getTargetFieldName(targetObject, mapping.targetFieldId);
                          const sourceLabel = describeMappingSource(mapping);
                          const badgeVariant = mapping.mappingType === 'collection' ? 'secondary' : 'outline';

                          return (
                            <div
                              key={mapping.id}
                              className="flex flex-col gap-2 rounded-lg border border-primary/50 bg-primary/5 p-3 shadow-sm"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium">{targetName}</span>
                                  <Badge variant={badgeVariant} className="flex items-center gap-1">
                                    {getMappingTypeLabel(mapping)}
                                  </Badge>
                                  {mapping.mappingType === 'collection' && (
                                    <span className="text-xs text-muted-foreground">
                                      Trenner: "{mapping.joinWith ?? defaultJoinWith}"
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <Badge
                                    variant="secondary"
                                    className="bg-primary text-primary-foreground hover:bg-primary"
                                  >
                                    Aktive Auswahl
                                  </Badge>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => openMappingEditor(mapping)}
                                    aria-label="Mapping bearbeiten"
                                  >
                                    <Edit3 className="h-4 w-4" />
                                    <span className="sr-only">Bearbeiten</span>
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive"
                                    onClick={() => handleRemoveMapping(mapping.id)}
                                    aria-label="Mapping entfernen"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    <span className="sr-only">Entfernen</span>
                                  </Button>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                <span>{sourceLabel}</span>
                                <ArrowRight className="h-3 w-3" />
                                <span>{targetName}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {Object.entries(otherTargetMappings).map(([objectType, mappingsForObject]) => {
                      const targetLabel = getTargetObjectDisplayName(objectType);

                      return (
                        <div key={objectType} className="space-y-3">
                          <div className="text-xs uppercase text-muted-foreground tracking-wide">
                            Weitere Mappings · {targetLabel}
                          </div>
                          {mappingsForObject.map((mapping) => {
                            const targetName = getTargetFieldName(objectType, mapping.targetFieldId);
                            const sourceLabel = describeMappingSource(mapping);
                            const badgeVariant = mapping.mappingType === 'collection' ? 'secondary' : 'outline';

                            return (
                              <div
                                key={mapping.id}
                                className="flex flex-col gap-2 rounded-lg border border-dashed border-border/70 bg-muted/10 p-3"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium">{targetName}</span>
                                    <Badge variant={badgeVariant} className="flex items-center gap-1">
                                      {getMappingTypeLabel(mapping)}
                                    </Badge>
                                    {mapping.mappingType === 'collection' && (
                                      <span className="text-xs text-muted-foreground">
                                        Trenner: "{mapping.joinWith ?? defaultJoinWith}"
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                  <span>{sourceLabel}</span>
                                  <ArrowRight className="h-3 w-3" />
                                  <span>{targetLabel} · {targetName}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Zum Bearbeiten zu {targetLabel} wechseln.
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={isMappingModalOpen} onOpenChange={(open) => (open ? null : closeMappingEditor())}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mapping konfigurieren</DialogTitle>
            <DialogDescription>
              Entscheide, ob der Zielwert direkt aus einem Feld übernommen oder aus einer Sammlung zusammengestellt
              wird.
            </DialogDescription>
          </DialogHeader>

          {draftMapping ? (
            <div className="space-y-6">
              <div className="space-y-3">
                <Label>Mapping-Typ</Label>
                <RadioGroup
                  value={draftMapping.mappingType}
                  onValueChange={(value) => handleMappingTypeChange(value as MappingType)}
                  className="grid gap-3 md:grid-cols-2"
                >
                  <div className="flex items-start gap-3 rounded-md border border-border p-3">
                    <RadioGroupItem value="direct" id="mapping-type-direct" />
                    <div className="space-y-1 text-sm">
                      <Label htmlFor="mapping-type-direct">Direktes Mapping</Label>
                      <p className="text-xs text-muted-foreground">
                        Übernimmt einen Wert unverändert in das Ziel.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-md border border-border p-3">
                    <RadioGroupItem
                      value="collection"
                      id="mapping-type-collection"
                      disabled={collectionCandidates.length === 0}
                    />
                    <div className="space-y-1 text-sm">
                      <Label htmlFor="mapping-type-collection">Sammlung transformieren</Label>
                      <p className="text-xs text-muted-foreground">
                        Extrahiert Werte aus einer Liste von Objekten und fügt sie zu einem Text zusammen.
                      </p>
                      {collectionCandidates.length === 0 && (
                        <p className="text-xs text-destructive">
                          Für dieses Objekt sind keine Sammlungen mit auswählbaren Feldern vorhanden.
                        </p>
                      )}
                    </div>
                  </div>
                </RadioGroup>
              </div>

              {draftMapping.mappingType === 'direct' && (
                <div className="space-y-2">
                  <Label htmlFor="direct-source">Quellfeld</Label>
                  <Select value={draftMapping.sourceFieldId} onValueChange={handleDirectSourceChange}>
                    <SelectTrigger id="direct-source">
                      <SelectValue placeholder="Feld auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceFields.map((field) => (
                        <SelectItem key={field.id} value={field.id}>
                          {field.name} {field.type ? `(${field.type})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Der ausgewählte Wert wird ohne Änderungen übernommen.
                  </p>
                </div>
              )}

              {draftMapping.mappingType === 'collection' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="collection-source">Sammlung</Label>
                    <Select
                      value={draftMapping.sourceFieldId}
                      onValueChange={handleCollectionFieldChange}
                    >
                      <SelectTrigger id="collection-source">
                        <SelectValue placeholder="Sammlung auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {collectionCandidates.map((field) => (
                          <SelectItem key={field.id} value={field.id}>
                            {field.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Wähle das Feld, das eine Liste von Objekten enthält (z. B. Mitglieder einer Karte).
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="collection-item">Feld innerhalb der Sammlung</Label>
                    <Select
                      value={draftMapping.collectionItemFieldId}
                      onValueChange={handleCollectionItemFieldChange}
                      disabled={!selectedCollectionField || !selectedCollectionField.children?.length}
                    >
                      <SelectTrigger id="collection-item">
                        <SelectValue
                          placeholder={
                            selectedCollectionField?.children?.length
                              ? 'Feld auswählen'
                              : 'Keine Felder verfügbar'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(selectedCollectionField?.children ?? []).map((child) => (
                          <SelectItem key={child.id} value={child.id}>
                            {child.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Dieses Feld wird aus jedem Eintrag gelesen und in das Ziel übernommen.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="collection-join">Trennzeichen</Label>
                    <Input
                      id="collection-join"
                      value={draftMapping.joinWith ?? defaultJoinWith}
                      onChange={(event) => handleJoinWithChange(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Wird zwischen die einzelnen Werte gesetzt (z. B. ", " für eine kommagetrennte Liste).
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Kein Mapping ausgewählt.
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeMappingEditor}>
              Abbrechen
            </Button>
            <Button onClick={handleSaveMappingDetails}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ungespeicherte Änderungen</AlertDialogTitle>
            <AlertDialogDescription>
              Sie haben ungespeicherte Mapping-Änderungen. Möchten Sie diese speichern, bevor Sie fortfahren?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscardChanges}>
              Verwerfen
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUnsavedDialog}>
              Speichern & Fortfahren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );

  return isFullscreen ? createPortal(content, document.body) : content;
};
