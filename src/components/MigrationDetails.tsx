import { Database, Settings as SettingsIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";

interface MigrationProject {
  id: string;
  name: string;
  progress: number;
  inConnector: string;
  inConnectorDetail: string;
  outConnector: string;
  outConnectorDetail: string;
  objectsTransferred: string;
  mappedObjects: string;
  activities: Activity[];
}

interface MigrationDetailsProps {
  project: MigrationProject;
}

const MigrationDetails = ({ project }: MigrationDetailsProps) => {
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const [configType, setConfigType] = useState<'in' | 'out'>('in');

  const handleEdit = (type: 'in' | 'out') => {
    setConfigType(type);
    setIsConfigDialogOpen(true);
  };

  const handleTest = (type: 'in' | 'out') => {
    console.log(`Testing ${type}connector connection...`);
    // Implement test logic here
  };

  const handleDelete = (type: 'in' | 'out') => {
    console.log(`Deleting ${type}connector configuration...`);
    // Implement delete logic here
  };

  return (
    <div className="h-full p-8 space-y-6">
      <Tabs defaultValue="general" className="w-full">
        <TabsList className="bg-muted">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="mapping">Mapping UI</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6 mt-6 pb-6">
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
                        Bearbeiten
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleTest('in')}>
                        Test
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDelete('in')} className="text-destructive">
                        Löschen
                      </DropdownMenuItem>
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
                        Bearbeiten
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleTest('out')}>
                        Test
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDelete('out')} className="text-destructive">
                        Löschen
                      </DropdownMenuItem>
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
        </TabsContent>

        <TabsContent value="mapping" className="mt-6 pb-6">
          <div className="bg-card border-border rounded-lg p-8 min-h-[500px] flex items-center justify-center">
            <p className="text-muted-foreground">Mapping UI visualization area</p>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isConfigDialogOpen} onOpenChange={setIsConfigDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {configType === 'in' ? 'Interconnector' : 'Outconnector'} Konfiguration
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                placeholder="Enter API key"
                type="password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                placeholder="Enter username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                placeholder="Enter password"
                type="password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endpoint">Endpoint</Label>
              <Input
                id="endpoint"
                placeholder="/api/v1/data"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setIsConfigDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={() => setIsConfigDialogOpen(false)}>
              Speichern
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MigrationDetails;
