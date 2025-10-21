import { Database, Settings as SettingsIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CircularProgress from "./CircularProgress";
import ActivityTimeline, { Activity } from "./ActivityTimeline";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MigrationProject {
  id: string;
  name: string;
  progress: number;
  sourceSystem: string;
  targetSystem: string;
  inConnector: string;
  inConnectorDetail: string;
  outConnector: string;
  outConnectorDetail: string;
  objectsTransferred: string;
  mappedObjects: string;
  activities: Activity[];
  connectors?: {
    in?: any;
    out?: any;
  };
}

interface MigrationDetailsProps {
  project: MigrationProject;
  activeTab: "general" | "mapping";
}

const MigrationDetails = ({ project, activeTab }: MigrationDetailsProps) => {
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const [configType, setConfigType] = useState<'in' | 'out'>('in');
  const [formData, setFormData] = useState({
    apiUrl: '',
    apiKey: '',
    username: '',
    password: '',
    endpoint: '',
  });

  const hasInConnector = !!project.connectors?.in;
  const hasOutConnector = !!project.connectors?.out;

  // Define objects based on system type
  const getSystemObjects = (system: string) => {
    const systemObjects: Record<string, { value: string; label: string }[]> = {
      "Jira Atlassian (Cloud)": [
        { value: "task", label: "Task" },
        { value: "issue", label: "Issue" },
        { value: "epic", label: "Epic" },
        { value: "story", label: "Story" },
        { value: "bug", label: "Bug" },
        { value: "subtask", label: "Subtask" },
      ],
      "Jira Atlassian (Server)": [
        { value: "task", label: "Task" },
        { value: "issue", label: "Issue" },
        { value: "epic", label: "Epic" },
        { value: "story", label: "Story" },
        { value: "bug", label: "Bug" },
        { value: "subtask", label: "Subtask" },
      ],
      "Azure DevOps": [
        { value: "user-story", label: "User Story" },
        { value: "task", label: "Task" },
        { value: "bug", label: "Bug" },
        { value: "feature", label: "Feature" },
        { value: "epic", label: "Epic" },
      ],
      "Monday.com": [
        { value: "item", label: "Item" },
        { value: "task", label: "Task" },
        { value: "project", label: "Project" },
        { value: "milestone", label: "Milestone" },
      ],
      "ClickUp": [
        { value: "task", label: "Task" },
        { value: "subtask", label: "Subtask" },
        { value: "checklist", label: "Checklist" },
        { value: "doc", label: "Doc" },
      ],
      "Asana": [
        { value: "project", label: "Project" },
        { value: "task", label: "Task" },
        { value: "section", label: "Section" },
        { value: "milestone", label: "Milestone" },
        { value: "tag", label: "Tag" },
      ],
      "Trello": [
        { value: "board", label: "Board" },
        { value: "card", label: "Card" },
        { value: "list", label: "List" },
        { value: "label", label: "Label" },
      ],
      "Notion": [
        { value: "page", label: "Page" },
        { value: "database", label: "Database" },
        { value: "task", label: "Task" },
        { value: "project", label: "Project" },
      ],
      "Linear": [
        { value: "issue", label: "Issue" },
        { value: "project", label: "Project" },
        { value: "cycle", label: "Cycle" },
        { value: "milestone", label: "Milestone" },
      ],
    };
    return systemObjects[system] || [];
  };

  const sourceObjects = getSystemObjects(project.sourceSystem);
  const targetObjects = getSystemObjects(project.targetSystem);

  const handleEdit = (type: 'in' | 'out') => {
    setConfigType(type);
    
    // Load existing connector data if available
    const connector = type === 'in' ? project.connectors?.in : project.connectors?.out;
    if (connector) {
      setFormData({
        apiUrl: connector.api_url || '',
        apiKey: connector.api_key || '',
        username: connector.username || '',
        password: connector.password || '',
        endpoint: connector.endpoint || '',
      });
    } else {
      setFormData({
        apiUrl: '',
        apiKey: '',
        username: '',
        password: '',
        endpoint: '',
      });
    }
    
    setIsConfigDialogOpen(true);
  };

  const handleTest = (type: 'in' | 'out') => {
    console.log(`Testing ${type}connector connection...`);
    // Implement test logic here
  };

  const handleDelete = async (type: 'in' | 'out') => {
    try {
      const { error } = await supabase
        .from('connectors')
        .delete()
        .eq('migration_id', project.id)
        .eq('connector_type', type);

      if (error) throw error;

      toast.success(`${type === 'in' ? 'Interconnector' : 'Outconnector'} gelöscht`);
      window.location.reload(); // Reload to refresh data
    } catch (error: any) {
      toast.error("Fehler beim Löschen");
      console.error(error);
    }
  };

  const handleSaveConnector = async () => {
    try {
      const connector = configType === 'in' ? project.connectors?.in : project.connectors?.out;
      
      const connectorData = {
        migration_id: project.id,
        connector_type: configType,
        api_url: formData.apiUrl,
        api_key: formData.apiKey,
        username: formData.username,
        password: formData.password,
        endpoint: formData.endpoint,
      };

      if (connector) {
        // Update existing connector
        const { error } = await supabase
          .from('connectors')
          .update(connectorData)
          .eq('id', connector.id);

        if (error) throw error;
        toast.success("Connector aktualisiert");
      } else {
        // Create new connector
        const { error } = await supabase
          .from('connectors')
          .insert(connectorData);

        if (error) throw error;
        toast.success("Connector erstellt");
      }

      setIsConfigDialogOpen(false);
      window.location.reload(); // Reload to refresh data
    } catch (error: any) {
      toast.error(error.message || "Fehler beim Speichern");
      console.error(error);
    }
  };

  return (
    <div className="h-full p-8 pb-6 space-y-6">
      {activeTab === "general" && (
        <div className="space-y-6 pb-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left column - Cards */}
            <div className="lg:col-span-2 space-y-6">
              {/* Progress Card */}
              <div className="flex justify-center">
                <div className="relative">
                  <CircularProgress progress={project.progress} />
                  <p className="text-center mt-4 text-sm text-muted-foreground">Progress</p>
                </div>
              </div>

              {/* Interconnector Card */}
              <Card className="bg-card border-border">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Interconnector</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {project.inConnectorDetail}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <SettingsIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit('in')}>
                        {hasInConnector ? 'Bearbeiten' : 'Erstellen'}
                      </DropdownMenuItem>
                      {hasInConnector && (
                        <>
                          <DropdownMenuItem onClick={() => handleTest('in')}>
                            Test
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDelete('in')} className="text-destructive">
                            Löschen
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm">
                    <span className={project.progress > 0 ? "text-success" : "text-muted-foreground"}>
                      Connection {project.progress > 0 ? "✓" : "—"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Objects transferred {project.objectsTransferred}
                  </p>
                </CardContent>
              </Card>

              {/* Outconnector Card */}
              <Card className="bg-card border-border">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Outconnector</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {project.outConnectorDetail}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <SettingsIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit('out')}>
                        {hasOutConnector ? 'Bearbeiten' : 'Erstellen'}
                      </DropdownMenuItem>
                      {hasOutConnector && (
                        <>
                          <DropdownMenuItem onClick={() => handleTest('out')}>
                            Test
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDelete('out')} className="text-destructive">
                            Löschen
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm">
                    <span className={project.progress === 100 ? "text-success" : "text-muted-foreground"}>
                      Connection {project.progress === 100 ? "✓" : "—"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Objects transferred {project.progress === 100 ? project.objectsTransferred : "0/0"}
                  </p>
                </CardContent>
              </Card>

              {/* Meta model Card */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-base">Meta model</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Mapped Jira Objects<br />
                      <span className="text-foreground">{project.mappedObjects}</span>
                    </p>
                    <div className={`w-12 h-12 rounded-full border-4 ${
                      project.progress === 100 ? "border-success" : "border-muted"
                    } flex items-center justify-center`}>
                      <Database className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right column - Activity Timeline */}
            <div className="lg:col-span-1">
              <Card className="bg-card border-border h-full">
                <CardHeader>
                  <CardTitle className="text-base">Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityTimeline activities={project.activities} />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {activeTab === "mapping" && (
        <div className="space-y-6 pb-6">
          {/* Dropdowns Section */}
          <div className="grid grid-cols-2 gap-6">
            {/* Left Dropdown - Source System Objects */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {project.sourceSystem} Objects
              </label>
              <Select>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Select source object" />
                </SelectTrigger>
                <SelectContent>
                  {sourceObjects.map((obj) => (
                    <SelectItem key={obj.value} value={obj.value}>
                      {obj.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Right Dropdown - Target System Objects */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {project.targetSystem} Objects
              </label>
              <Select>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Select target object" />
                </SelectTrigger>
                <SelectContent>
                  {targetObjects.map((obj) => (
                    <SelectItem key={obj.value} value={obj.value}>
                      {obj.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Whiteboard Canvas Area */}
          <div className="bg-background border-2 border-border rounded-lg min-h-[600px] p-4">
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              Mapping canvas area
            </div>
          </div>
        </div>
      )}

      <Dialog open={isConfigDialogOpen} onOpenChange={setIsConfigDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {configType === 'in' ? 'Interconnector' : 'Outconnector'} {hasInConnector || hasOutConnector ? 'Bearbeiten' : 'Erstellen'}
            </DialogTitle>
            <DialogDescription>
              Konfigurieren Sie die API-Verbindungseinstellungen für den {configType === 'in' ? 'Interconnector' : 'Outconnector'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="api-url">API URL</Label>
              <Input
                id="api-url"
                placeholder="https://api.example.com"
                type="url"
                value={formData.apiUrl}
                onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                placeholder="Enter API key"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                placeholder="Enter username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                placeholder="Enter password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endpoint">Endpoint</Label>
              <Input
                id="endpoint"
                placeholder="/api/v1/data"
                value={formData.endpoint}
                onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setIsConfigDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSaveConnector}>
              Speichern
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MigrationDetails;
