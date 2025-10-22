import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Puzzle, ArrowRight, Wand2 } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "sonner";

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
    { id: "id", name: "ID", type: "text" },
    { id: "title", name: "Title", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "createdAt", name: "Created At", type: "date" },
    { id: "modifiedAt", name: "Modified At", type: "date" },
    { id: "completed", name: "Completed", type: "boolean" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "tags", name: "Tags", type: "array" },
    { id: "subtasks", name: "Subtasks", type: "array" },
    { id: "attachments", name: "Attachments", type: "array" },
  ],
  "asana-user": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "email", name: "Email", type: "text" },
    { id: "role", name: "Role", type: "enum" },
    { id: "teams", name: "Teams", type: "array" },
  ],
  "asana-project": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "owner", name: "Owner", type: "user" },
    { id: "createdAt", name: "Created At", type: "date" },
    { id: "status", name: "Status", type: "enum" },
    { id: "tasks", name: "Tasks", type: "array" },
  ],
  "asana-section": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "projectId", name: "Project ID", type: "text" },
    { id: "createdAt", name: "Created At", type: "date" },
  ],
  "asana-milestone": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "projectId", name: "Project ID", type: "text" },
    { id: "completed", name: "Completed", type: "boolean" },
  ],
  "asana-tag": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "color", name: "Color", type: "text" },
  ],
  
  // Jira
  "jira-issue": [
    { id: "id", name: "ID", type: "text" },
    { id: "key", name: "Key", type: "text" },
    { id: "summary", name: "Summary", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "reporter", name: "Reporter", type: "user" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "status", name: "Status", type: "enum" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "labels", name: "Labels", type: "array" },
    { id: "created", name: "Created", type: "date" },
    { id: "updated", name: "Updated", type: "date" },
    { id: "duedate", name: "Due Date", type: "date" },
    { id: "comments", name: "Comments", type: "array" },
    { id: "attachments", name: "Attachments", type: "array" },
    { id: "customfields", name: "Custom Fields", type: "object" },
  ],
  "jira-task": [
    { id: "id", name: "ID", type: "text" },
    { id: "key", name: "Key", type: "text" },
    { id: "summary", name: "Summary", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "status", name: "Status", type: "enum" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "duedate", name: "Due Date", type: "date" },
  ],
  "jira-epic": [
    { id: "id", name: "ID", type: "text" },
    { id: "key", name: "Key", type: "text" },
    { id: "summary", name: "Summary", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "owner", name: "Owner", type: "user" },
    { id: "startDate", name: "Start Date", type: "date" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "status", name: "Status", type: "enum" },
  ],
  "jira-story": [
    { id: "id", name: "ID", type: "text" },
    { id: "key", name: "Key", type: "text" },
    { id: "summary", name: "Summary", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "status", name: "Status", type: "enum" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "storyPoints", name: "Story Points", type: "number" },
  ],
  "jira-bug": [
    { id: "id", name: "ID", type: "text" },
    { id: "key", name: "Key", type: "text" },
    { id: "summary", name: "Summary", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "status", name: "Status", type: "enum" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "severity", name: "Severity", type: "enum" },
  ],
  "jira-subtask": [
    { id: "id", name: "ID", type: "text" },
    { id: "key", name: "Key", type: "text" },
    { id: "summary", name: "Summary", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "parentId", name: "Parent ID", type: "text" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "status", name: "Status", type: "enum" },
  ],
  "jira-user": [
    { id: "accountId", name: "Account ID", type: "text" },
    { id: "displayName", name: "Display Name", type: "text" },
    { id: "emailAddress", name: "Email Address", type: "text" },
    { id: "active", name: "Active", type: "boolean" },
    { id: "timeZone", name: "Time Zone", type: "text" },
    { id: "groups", name: "Groups", type: "array" },
  ],
  "jira-project": [
    { id: "id", name: "ID", type: "text" },
    { id: "key", name: "Key", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "lead", name: "Lead", type: "user" },
    { id: "type", name: "Type", type: "enum" },
    { id: "workflowScheme", name: "Workflow Scheme", type: "text" },
  ],
  
  // Azure DevOps
  "azure-work-item": [
    { id: "id", name: "ID", type: "text" },
    { id: "title", name: "Title", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignedTo", name: "Assigned To", type: "user" },
    { id: "state", name: "State", type: "enum" },
    { id: "areaPath", name: "Area Path", type: "text" },
    { id: "iterationPath", name: "Iteration Path", type: "text" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "tags", name: "Tags", type: "array" },
    { id: "createdDate", name: "Created Date", type: "date" },
    { id: "changedDate", name: "Changed Date", type: "date" },
  ],
  "azure-user-story": [
    { id: "id", name: "ID", type: "text" },
    { id: "title", name: "Title", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignedTo", name: "Assigned To", type: "user" },
    { id: "state", name: "State", type: "enum" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "storyPoints", name: "Story Points", type: "number" },
    { id: "acceptanceCriteria", name: "Acceptance Criteria", type: "text" },
  ],
  "azure-task": [
    { id: "id", name: "ID", type: "text" },
    { id: "title", name: "Title", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignedTo", name: "Assigned To", type: "user" },
    { id: "state", name: "State", type: "enum" },
    { id: "remainingWork", name: "Remaining Work", type: "number" },
  ],
  "azure-bug": [
    { id: "id", name: "ID", type: "text" },
    { id: "title", name: "Title", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignedTo", name: "Assigned To", type: "user" },
    { id: "state", name: "State", type: "enum" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "severity", name: "Severity", type: "enum" },
    { id: "stepsToReproduce", name: "Steps to Reproduce", type: "text" },
  ],
  "azure-feature": [
    { id: "id", name: "ID", type: "text" },
    { id: "title", name: "Title", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignedTo", name: "Assigned To", type: "user" },
    { id: "state", name: "State", type: "enum" },
    { id: "targetDate", name: "Target Date", type: "date" },
  ],
  "azure-epic": [
    { id: "id", name: "ID", type: "text" },
    { id: "title", name: "Title", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignedTo", name: "Assigned To", type: "user" },
    { id: "state", name: "State", type: "enum" },
    { id: "startDate", name: "Start Date", type: "date" },
    { id: "targetDate", name: "Target Date", type: "date" },
  ],
  "azure-user": [
    { id: "id", name: "ID", type: "text" },
    { id: "displayName", name: "Display Name", type: "text" },
    { id: "emailAddress", name: "Email Address", type: "text" },
    { id: "uniqueName", name: "Unique Name", type: "text" },
    { id: "domain", name: "Domain", type: "text" },
  ],
  "azure-project": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "state", name: "State", type: "enum" },
    { id: "defaultTeam", name: "Default Team", type: "text" },
  ],
  
  // Monday.com
  "monday-item": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "columnValues", name: "Column Values", type: "object" },
    { id: "creator", name: "Creator", type: "user" },
    { id: "subitems", name: "Subitems", type: "array" },
    { id: "boardId", name: "Board ID", type: "text" },
  ],
  "monday-task": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "status", name: "Status", type: "enum" },
    { id: "person", name: "Person", type: "user" },
    { id: "date", name: "Date", type: "date" },
    { id: "priority", name: "Priority", type: "enum" },
  ],
  "monday-project": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "owner", name: "Owner", type: "user" },
    { id: "status", name: "Status", type: "enum" },
    { id: "startDate", name: "Start Date", type: "date" },
    { id: "endDate", name: "End Date", type: "date" },
  ],
  "monday-milestone": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "completed", name: "Completed", type: "boolean" },
  ],
  "monday-user": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "email", name: "Email", type: "text" },
    { id: "photoSmall", name: "Photo", type: "text" },
    { id: "isGuest", name: "Is Guest", type: "boolean" },
  ],
  "monday-board": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "groups", name: "Groups", type: "array" },
  ],
  
  // ClickUp
  "clickup-task": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "textContent", name: "Text Content", type: "text" },
    { id: "status", name: "Status", type: "enum" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "creator", name: "Creator", type: "user" },
    { id: "assignees", name: "Assignees", type: "array" },
    { id: "tags", name: "Tags", type: "array" },
    { id: "customFields", name: "Custom Fields", type: "object" },
  ],
  "clickup-subtask": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "parentTaskId", name: "Parent Task ID", type: "text" },
    { id: "status", name: "Status", type: "enum" },
    { id: "assignees", name: "Assignees", type: "array" },
  ],
  "clickup-checklist": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "taskId", name: "Task ID", type: "text" },
    { id: "items", name: "Items", type: "array" },
  ],
  "clickup-doc": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "content", name: "Content", type: "text" },
    { id: "creator", name: "Creator", type: "user" },
    { id: "createdAt", name: "Created At", type: "date" },
  ],
  "clickup-user": [
    { id: "id", name: "ID", type: "text" },
    { id: "username", name: "Username", type: "text" },
    { id: "email", name: "Email", type: "text" },
    { id: "profilePicture", name: "Profile Picture", type: "text" },
    { id: "role", name: "Role", type: "enum" },
  ],
  "clickup-space": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "lists", name: "Lists", type: "array" },
  ],
  
  // Planisware
  "planisware-project": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "manager", name: "Manager", type: "user" },
    { id: "startDate", name: "Start Date", type: "date" },
    { id: "endDate", name: "End Date", type: "date" },
    { id: "status", name: "Status", type: "enum" },
    { id: "budget", name: "Budget", type: "number" },
  ],
  "planisware-task": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "owner", name: "Owner", type: "user" },
    { id: "progress", name: "Progress", type: "number" },
    { id: "startDate", name: "Start Date", type: "date" },
    { id: "endDate", name: "End Date", type: "date" },
    { id: "duration", name: "Duration", type: "number" },
    { id: "dependencies", name: "Dependencies", type: "array" },
  ],
  "planisware-resource": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "role", name: "Role", type: "enum" },
    { id: "costRate", name: "Cost Rate", type: "number" },
    { id: "availability", name: "Availability", type: "number" },
  ],
  
  // Trello
  "trello-card": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "desc", name: "Description", type: "text" },
    { id: "idList", name: "List ID", type: "text" },
    { id: "idMembers", name: "Members", type: "array" },
    { id: "labels", name: "Labels", type: "array" },
    { id: "due", name: "Due Date", type: "date" },
    { id: "attachments", name: "Attachments", type: "array" },
  ],
  "trello-list": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "idBoard", name: "Board ID", type: "text" },
    { id: "pos", name: "Position", type: "number" },
    { id: "closed", name: "Closed", type: "boolean" },
  ],
  "trello-label": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "color", name: "Color", type: "text" },
    { id: "idBoard", name: "Board ID", type: "text" },
  ],
  "trello-member": [
    { id: "id", name: "ID", type: "text" },
    { id: "fullName", name: "Full Name", type: "text" },
    { id: "username", name: "Username", type: "text" },
    { id: "email", name: "Email", type: "text" },
    { id: "initials", name: "Initials", type: "text" },
    { id: "status", name: "Status", type: "enum" },
  ],
  "trello-board": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "lists", name: "Lists", type: "array" },
    { id: "members", name: "Members", type: "array" },
  ],
  
  // Notion
  "notion-page": [
    { id: "id", name: "ID", type: "text" },
    { id: "title", name: "Title", type: "text" },
    { id: "content", name: "Content", type: "text" },
    { id: "parentId", name: "Parent ID", type: "text" },
    { id: "createdBy", name: "Created By", type: "user" },
    { id: "createdTime", name: "Created Time", type: "date" },
    { id: "lastEditedTime", name: "Last Edited Time", type: "date" },
  ],
  "notion-database": [
    { id: "id", name: "ID", type: "text" },
    { id: "title", name: "Title", type: "text" },
    { id: "properties", name: "Properties", type: "object" },
    { id: "createdBy", name: "Created By", type: "user" },
    { id: "createdTime", name: "Created Time", type: "date" },
  ],
  "notion-task": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "status", name: "Status", type: "enum" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "priority", name: "Priority", type: "enum" },
  ],
  "notion-project": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "owner", name: "Owner", type: "user" },
    { id: "status", name: "Status", type: "enum" },
    { id: "startDate", name: "Start Date", type: "date" },
    { id: "endDate", name: "End Date", type: "date" },
  ],
  
  // Linear
  "linear-issue": [
    { id: "id", name: "ID", type: "text" },
    { id: "title", name: "Title", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "assignee", name: "Assignee", type: "user" },
    { id: "status", name: "Status", type: "enum" },
    { id: "priority", name: "Priority", type: "enum" },
    { id: "createdAt", name: "Created At", type: "date" },
    { id: "updatedAt", name: "Updated At", type: "date" },
    { id: "dueDate", name: "Due Date", type: "date" },
    { id: "labels", name: "Labels", type: "array" },
  ],
  "linear-project": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "lead", name: "Lead", type: "user" },
    { id: "status", name: "Status", type: "enum" },
    { id: "startDate", name: "Start Date", type: "date" },
    { id: "targetDate", name: "Target Date", type: "date" },
  ],
  "linear-cycle": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "number", name: "Number", type: "number" },
    { id: "startDate", name: "Start Date", type: "date" },
    { id: "endDate", name: "End Date", type: "date" },
    { id: "completedAt", name: "Completed At", type: "date" },
  ],
  "linear-milestone": [
    { id: "id", name: "ID", type: "text" },
    { id: "name", name: "Name", type: "text" },
    { id: "description", name: "Description", type: "text" },
    { id: "targetDate", name: "Target Date", type: "date" },
    { id: "completed", name: "Completed", type: "boolean" },
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
          m => m.sourceFieldId === sourceField.id && m.targetFieldId === matchingTargetField.id
        );
        if (!exists) {
          newMappings.push({
            sourceFieldId: sourceField.id,
            targetFieldId: matchingTargetField.id
          });
        }
      }
    });

    if (newMappings.length > 0) {
      setMappings(prev => [...prev, ...newMappings]);
      toast.success(`Auto-mapped ${newMappings.length} field${newMappings.length > 1 ? 's' : ''}`);
    } else {
      toast.info("No matching fields found");
    }
  };

  // Get all mapped target fields for a source field (or vice versa)
  const getMappedFields = (side: 'source' | 'target', fieldId: string): string[] => {
    return mappings
      .filter(m => side === 'source' ? m.sourceFieldId === fieldId : m.targetFieldId === fieldId)
      .map(m => side === 'source' ? m.targetFieldId : m.sourceFieldId);
  };

  // Check if field is involved in hover highlighting
  const isHighlighted = (side: 'source' | 'target', fieldId: string): boolean => {
    if (!hoveredField) return false;
    
    // If this field is hovered
    if (hoveredField === fieldId) return true;
    
    // Check if this field is connected to the hovered field
    const hoveredInSource = mappings.some(m => m.sourceFieldId === hoveredField);
    const hoveredInTarget = mappings.some(m => m.targetFieldId === hoveredField);
    
    if (hoveredInSource) {
      // Hovered field is a source field, highlight all its targets
      return mappings.some(m => m.sourceFieldId === hoveredField && m.targetFieldId === fieldId);
    } else if (hoveredInTarget) {
      // Hovered field is a target field, highlight all its sources
      return mappings.some(m => m.targetFieldId === hoveredField && m.sourceFieldId === fieldId);
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

    // Check if this exact mapping already exists
    const exactMappingExists = mappings.some(
      m => m.sourceFieldId === sourceFieldId && m.targetFieldId === targetFieldId
    );

    if (exactMappingExists) {
      // Remove this specific mapping
      setMappings(prev => prev.filter(
        m => !(m.sourceFieldId === sourceFieldId && m.targetFieldId === targetFieldId)
      ));
      toast.info("Mapping removed");
    } else {
      // Add new mapping (allowing multiple mappings per field)
      setMappings(prev => [...prev, { sourceFieldId, targetFieldId }]);
      toast.success("Mapping added");
    }

    setDraggedField(null);
  };

  const handleRemoveMapping = (sourceFieldId: string, targetFieldId: string) => {
    setMappings(prev => prev.filter(
      m => !(m.sourceFieldId === sourceFieldId && m.targetFieldId === targetFieldId)
    ));
  };

  const isMapped = (side: 'source' | 'target', fieldId: string) => {
    return mappings.some(m => 
      side === 'source' ? m.sourceFieldId === fieldId : m.targetFieldId === fieldId
    );
  };

  return (
    <div className="space-y-4">
      {/* Auto-Map Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleAutoMap}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Wand2 className="h-4 w-4" />
          Auto Map
        </Button>
      </div>

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
            const mappedTargetIds = getMappedFields('source', field.id);
            const mappedTargets = targetFields.filter(f => mappedTargetIds.includes(f.id));
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
                
                {mappedTargets.length > 0 && (
                  <div className="flex flex-col gap-1 pl-6">
                    {mappedTargets.map(target => (
                      <div key={target.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ArrowRight className="h-3 w-3" />
                        <span>{target.name}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-4 w-4 p-0 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveMapping(field.id, target.id);
                          }}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
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
            const mappedSourceIds = getMappedFields('target', field.id);
            const mappedSources = sourceFields.filter(f => mappedSourceIds.includes(f.id));
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
                
                {mappedSources.length > 0 && (
                  <div className="flex flex-col gap-1 pl-6">
                    {mappedSources.map(source => (
                      <div key={source.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{source.name}</span>
                        <ArrowRight className="h-3 w-3" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-4 w-4 p-0 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveMapping(source.id, field.id);
                          }}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
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
                        onClick={() => handleRemoveMapping(mapping.sourceFieldId, mapping.targetFieldId)}
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
    </div>
  );
};
