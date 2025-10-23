import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Trash2,
  Pencil,
  Database,
  GitBranch,
  Github,
  Gitlab,
  Cloud,
  Box,
  Plug,
  ShieldCheck,
  Globe2,
  Power,
  Link2,
  Sparkles
} from "lucide-react";
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
      <div className="app-shell flex min-h-screen items-center justify-center p-6">
        <p className="text-muted-foreground">Laden...</p>
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen flex-col p-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="app-surface flex items-center justify-between rounded-3xl px-6 py-5">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="rounded-full border border-border/60"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5">
                <Plug className="h-6 w-6 text-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Datenquellen</h1>
                <p className="text-sm text-muted-foreground">Verwalte die Systeme, die du anbindest.</p>
              </div>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => handleOpenDialog()}
            className="rounded-full px-5 py-2"
          >
            + Datenquelle
          </Button>
        </div>

        <div className="app-surface rounded-3xl p-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {dataSources.map((source) => {
              const SourceIcon = getSourceIcon(source.source_type);
              const availabilityText = source.is_global
                ? "Global"
                : source.assigned_projects && source.assigned_projects.length > 0
                ? `${source.assigned_projects.length} ${source.assigned_projects.length === 1 ? "Projekt" : "Projekte"}`
                : "Kein Zugriff";
              return (
                <Card key={source.id} className="app-subtle border border-border/50">
                  <CardHeader className="flex flex-row items-center gap-4 pb-3">
                    <div className="flex-shrink-0">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/50 bg-foreground/5">
                        <SourceIcon className="h-6 w-6 text-foreground" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg text-foreground">{source.name}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">{source.source_type}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenDialog(source)}
                        className="rounded-full hover:bg-foreground/5"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(source.id)}
                        className="rounded-full text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="ml-16 space-y-3 text-sm">
                      {source.api_url && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Link2 className="h-4 w-4" />
                          <span className="truncate">{source.api_url}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <ShieldCheck className="h-4 w-4" />
                        <span>Auth: {source.auth_type}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Globe2 className="h-4 w-4" />
                        <span>{availabilityText}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Power className={`h-4 w-4 ${source.is_active ? "text-success" : ""}`} />
                        <span className={source.is_active ? "text-success" : "text-muted-foreground"}>
                          {source.is_active ? "Aktiv" : "Inaktiv"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {dataSources.length === 0 && (
              <div className="app-subtle col-span-full flex flex-col items-center justify-center gap-4 rounded-2xl px-10 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5">
                  <Sparkles className="h-6 w-6 text-foreground" />
                </div>
                <p className="text-muted-foreground">Noch keine Datenquellen vorhanden</p>
                <Button
                  type="button"
                  onClick={() => handleOpenDialog()}
                  variant="outline"
                  className="rounded-full px-5"
                >
                  + Datenquelle
                </Button>
              </div>
            )}
          </div>
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
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source_type">Typ</Label>
                <Select
                  value={formData.source_type}
                  onValueChange={(value) => setFormData({ ...formData, source_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Quelle auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {defaultSourceTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="api_url">API URL</Label>
                <Input
                  id="api_url"
                  value={formData.api_url}
                  onChange={(e) => setFormData({ ...formData, api_url: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api_key">API Key</Label>
                <Input
                  id="api_key"
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">Benutzername</Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Passwort</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Authentifizierung</Label>
                <Select
                  value={formData.auth_type}
                  onValueChange={(value) => setFormData({ ...formData, auth_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api_key">API Key</SelectItem>
                    <SelectItem value="basic">Basic Auth</SelectItem>
                    <SelectItem value="oauth2">OAuth2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="is_global">Global verfügbar</Label>
                <div className="flex items-center gap-2 rounded-full border border-border/50 px-3 py-2">
                  <Switch
                    id="is_global"
                    checked={formData.is_global}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_global: checked })}
                  />
                  <span className="text-sm text-muted-foreground">
                    Wenn aktiviert, für alle Projekte verfügbar
                  </span>
                </div>
              </div>
            </div>

            {!formData.is_global && (
              <div className="space-y-2">
                <Label>Projekte</Label>
                <div className="rounded-2xl border border-border/50 p-4">
                  <Select
                    value=""
                    onValueChange={(value) => {
                      if (!selectedProjects.includes(value)) {
                        setSelectedProjects([...selectedProjects, value]);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Projekt auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Kein Projekt</SelectItem>
                      <SelectSeparator />
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedProjects.map((projectId) => {
                      const project = projects.find((p) => p.id === projectId);
                      return (
                        <span
                          key={projectId}
                          className="rounded-full border border-border/50 px-3 py-1 text-xs text-muted-foreground"
                        >
                          {project?.name || projectId}
                        </span>
                      );
                    })}
                    {selectedProjects.length === 0 && (
                      <span className="text-sm text-muted-foreground">Noch keine Projekte zugewiesen</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="rounded-full">
              Abbrechen
            </Button>
            <Button onClick={handleSave} className="rounded-full px-5">
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DataSources;
