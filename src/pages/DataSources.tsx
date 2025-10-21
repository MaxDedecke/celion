import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Pencil, Database, GitBranch, Github, Gitlab, Cloud, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface DataSource {
  id: string;
  name: string;
  source_type: string;
  api_url?: string;
  api_key?: string;
  username?: string;
  password?: string;
  auth_type: string;
  is_active: boolean;
  is_global: boolean;
  created_at: string;
  assigned_projects?: string[];
}

const DataSources = () => {
  const navigate = useNavigate();
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    name: "",
    source_type: "jira",
    api_url: "",
    api_key: "",
    username: "",
    password: "",
    auth_type: "api_key",
    is_active: true,
    is_global: false,
  });

  const defaultSourceTypes = [
    "Jira Server / Jira Data Center",
    "Azure DevOps Server (früher TFS)",
    "GitLab (Self-Managed Edition)",
    "GitHub Enterprise Server",
    "Redmine",
    "OpenProject",
    "Taiga",
    "YouTrack (Self-Hosted)",
    "Targetprocess",
    "Planisware",
    "Tuleap",
    "Trac",
    "Phabricator",
    "Bugzilla",
    "MantisBT",
    "Easy Redmine",
    "Odoo Project",
    "ClickUp",
    "Wrike Enterprise",
    "Monday.com",
    "Smartsheet",
    "Asana",
    "Trello",
    "Notion",
    "Basecamp",
    "Celoxis",
    "Orangescrum",
    "Zoho Projects",
    "ProjeQtOr",
    "Hansoft",
    "Rational Team Concert",
    "Polarion ALM",
    "Micro Focus ALM / Octane",
    "SAP Project System",
    "HP Project and Portfolio Management",
    "Clarizen One",
    "Sciforma",
    "Leankit",
    "MeisterTask",
    "Airtable",
  ];

  useEffect(() => {
    checkAuth();
    loadProjects();
    loadDataSources();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/");
    }
  };

  const getSourceIcon = (sourceType: string) => {
    const type = sourceType.toLowerCase();
    if (type.includes('jira')) return Database;
    if (type.includes('azure') || type.includes('devops')) return Cloud;
    if (type.includes('github')) return Github;
    if (type.includes('gitlab')) return Gitlab;
    if (type.includes('git')) return GitBranch;
    return Box;
  };

  const loadProjects = async () => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .order("name", { ascending: true });

      if (error) throw error;
      setProjects(data || []);
    } catch (error: any) {
      console.error("Fehler beim Laden der Projekte:", error);
    }
  };

  const loadDataSources = async () => {
    try {
      const { data, error } = await supabase
        .from("data_sources")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Load project assignments for each data source
      const sourcesWithProjects = await Promise.all(
        (data || []).map(async (source) => {
          const { data: assignments } = await supabase
            .from("data_source_projects")
            .select("project_id")
            .eq("data_source_id", source.id);

          return {
            ...source,
            assigned_projects: assignments?.map((a) => a.project_id) || [],
          };
        })
      );

      setDataSources(sourcesWithProjects);
    } catch (error: any) {
      toast.error("Fehler beim Laden der Datenquellen");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (source?: DataSource) => {
    if (source) {
      setEditingSource(source);
      setFormData({
        name: source.name,
        source_type: source.source_type,
        api_url: source.api_url || "",
        api_key: source.api_key || "",
        username: source.username || "",
        password: source.password || "",
        auth_type: source.auth_type,
        is_active: source.is_active,
        is_global: source.is_global,
      });
      setSelectedProjects(source.assigned_projects || []);
    } else {
      setEditingSource(null);
      setFormData({
        name: "",
        source_type: "jira",
        api_url: "",
        api_key: "",
        username: "",
        password: "",
        auth_type: "api_key",
        is_active: true,
        is_global: false,
      });
      setSelectedProjects([]);
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nicht authentifiziert");

      let sourceId: string;

      if (editingSource) {
        const { error } = await supabase
          .from("data_sources")
          .update(formData)
          .eq("id", editingSource.id);

        if (error) throw error;
        sourceId = editingSource.id;
        
        // Delete existing project assignments
        await supabase
          .from("data_source_projects")
          .delete()
          .eq("data_source_id", sourceId);
        
        toast.success("Datenquelle aktualisiert");
      } else {
        const { data, error } = await supabase
          .from("data_sources")
          .insert({ ...formData, user_id: user.id })
          .select()
          .single();

        if (error) throw error;
        sourceId = data.id;
        toast.success("Datenquelle erstellt");
      }

      // Add new project assignments (only if not global)
      if (!formData.is_global && selectedProjects.length > 0) {
        const assignments = selectedProjects.map((projectId) => ({
          data_source_id: sourceId,
          project_id: projectId,
        }));

        const { error: assignmentError } = await supabase
          .from("data_source_projects")
          .insert(assignments);

        if (assignmentError) throw assignmentError;
      }

      setIsDialogOpen(false);
      loadDataSources();
    } catch (error: any) {
      toast.error(error.message || "Fehler beim Speichern");
      console.error(error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from("data_sources")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast.success("Datenquelle gelöscht");
      loadDataSources();
    } catch (error: any) {
      toast.error("Fehler beim Löschen");
      console.error(error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Laden...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold">Datenquellen</h1>
            <p className="text-muted-foreground mt-1">
              Verwalten Sie Ihre Unternehmens-Datenquellen
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Neue Datenquelle
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {dataSources.map((source) => {
            const SourceIcon = getSourceIcon(source.source_type);
            return (
              <Card key={source.id} className="bg-card border-border">
                <CardHeader className="flex flex-row items-center gap-4 pb-3">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <SourceIcon className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg">{source.name}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {source.source_type}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenDialog(source)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(source.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm ml-16">
                    {source.api_url && (
                      <p className="text-muted-foreground truncate">
                        URL: {source.api_url}
                      </p>
                    )}
                    <p className="text-muted-foreground">
                      Auth: {source.auth_type}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Verfügbarkeit:</span>
                      <span className="text-foreground">
                        {source.is_global
                          ? "Global"
                          : source.assigned_projects && source.assigned_projects.length > 0
                          ? `${source.assigned_projects.length} ${source.assigned_projects.length === 1 ? 'Projekt' : 'Projekte'}`
                          : "Kein Zugriff"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Status:</span>
                      <span
                        className={
                          source.is_active ? "text-success" : "text-muted-foreground"
                        }
                      >
                        {source.is_active ? "Aktiv" : "Inaktiv"}
                      </span>
                    </div>
                  </div>
                </CardContent>
            </Card>
            );
          })}

          {dataSources.length === 0 && (
            <div className="col-span-full text-center py-12">
              <p className="text-muted-foreground">
                Noch keine Datenquellen vorhanden
              </p>
              <Button
                onClick={() => handleOpenDialog()}
                className="mt-4"
                variant="outline"
              >
                <Plus className="h-4 w-4 mr-2" />
                Erste Datenquelle erstellen
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingSource ? "Datenquelle bearbeiten" : "Neue Datenquelle"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="z.B. Jira Production"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source_type">Typ</Label>
                <Select
                  value={formData.source_type}
                  onValueChange={(value) =>
                    setFormData({ ...formData, source_type: value })
                  }
                >
                  <SelectTrigger id="source_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dataSources.length > 0 && (
                      <>
                        {dataSources.map((source) => (
                          <SelectItem 
                            key={source.id} 
                            value={source.source_type}
                            className="font-bold text-primary"
                          >
                            {source.source_type}
                          </SelectItem>
                        ))}
                        <SelectSeparator />
                      </>
                    )}
                    {defaultSourceTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api_url">API URL</Label>
              <Input
                id="api_url"
                value={formData.api_url}
                onChange={(e) =>
                  setFormData({ ...formData, api_url: e.target.value })
                }
                placeholder="https://api.example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="auth_type">Authentifizierungstyp</Label>
              <Select
                value={formData.auth_type}
                onValueChange={(value) =>
                  setFormData({ ...formData, auth_type: value })
                }
              >
                <SelectTrigger id="auth_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api_key">API Key</SelectItem>
                  <SelectItem value="basic">Basic Auth</SelectItem>
                  <SelectItem value="oauth">OAuth</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.auth_type === "api_key" && (
              <div className="space-y-2">
                <Label htmlFor="api_key">API Key</Label>
                <Input
                  id="api_key"
                  type="password"
                  value={formData.api_key}
                  onChange={(e) =>
                    setFormData({ ...formData, api_key: e.target.value })
                  }
                  placeholder="Ihr API Key"
                />
              </div>
            )}

            {formData.auth_type === "basic" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Benutzername</Label>
                  <Input
                    id="username"
                    value={formData.username}
                    onChange={(e) =>
                      setFormData({ ...formData, username: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Passwort</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked })
                  }
                />
                <Label htmlFor="is_active">Aktiv</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="is_global"
                  checked={formData.is_global}
                  onCheckedChange={(checked) => {
                    setFormData({ ...formData, is_global: checked });
                    if (checked) {
                      setSelectedProjects([]);
                    }
                  }}
                />
                <Label htmlFor="is_global">Global verfügbar</Label>
              </div>
            </div>

            {!formData.is_global && (
              <div className="space-y-2">
                <Label>Verfügbar für Projekte</Label>
                <div className="border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                  {projects.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Keine Projekte vorhanden
                    </p>
                  ) : (
                    projects.map((project) => (
                      <div key={project.id} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`project-${project.id}`}
                          checked={selectedProjects.includes(project.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedProjects([...selectedProjects, project.id]);
                            } else {
                              setSelectedProjects(
                                selectedProjects.filter((id) => id !== project.id)
                              );
                            }
                          }}
                          className="rounded border-input"
                        />
                        <label
                          htmlFor={`project-${project.id}`}
                          className="text-sm cursor-pointer flex-1"
                        >
                          {project.name}
                        </label>
                      </div>
                    ))
                  )}
                </div>
                {!formData.is_global && selectedProjects.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    ⚠️ Warnung: Ohne Projektzuweisung hat niemand Zugriff auf diese Datenquelle
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSave}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DataSources;
