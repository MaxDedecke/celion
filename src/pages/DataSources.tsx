import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plug, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import DataFlowLoader from "@/components/DataFlowLoader";
import { databaseClient } from "@/api/databaseClient";
import { useMinimumLoader } from "@/hooks/useMinimumLoader";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { DATA_SOURCE_TYPE_OPTIONS, type DataSourceType } from "@/constants/sourceTypes";
import { DataSourceCard } from "@/components/datasources/DataSourceCard";
import { BasicInfoStep } from "@/components/datasources/wizard/BasicInfoStep";
import type { DataSourceWithProjects, ProjectSummary, DataSourceFormData } from "@/types/dataSource";
import {
  createInitialDataSourceFormData,
  mapDataSourceToFormData,
  buildDataSourceAdditionalConfig,
  getErrorMessage,
} from "@/lib/dataSourceHelpers";
import type { TablesInsert } from "@/integrations/database/types";

const SOURCE_TYPE_OPTIONS = DATA_SOURCE_TYPE_OPTIONS;

const DataSources = () => {
  const navigate = useNavigate();
  const [dataSources, setDataSources] = useState<DataSourceWithProjects[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const loaderVisible = useMinimumLoader(loading, 1000);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<DataSourceWithProjects | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [formData, setFormData] = useState<DataSourceFormData>(() => createInitialDataSourceFormData());
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const handleDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open);
  };

  const sourceTypeOptions = SOURCE_TYPE_OPTIONS.includes(
    formData.source_type as DataSourceType
  )
    ? [...SOURCE_TYPE_OPTIONS]
    : [formData.source_type, ...SOURCE_TYPE_OPTIONS];

  const checkAuth = useCallback(async () => {
    const { data: { session } } = await databaseClient.getSession();
    if (!session) {
      navigate("/");
    }
  }, [navigate]);

  const loadProjects = useCallback(async (): Promise<void> => {
    try {
      const { data, error } = await databaseClient.fetchProjectNames();

      if (error) throw error;
      setProjects(data ?? []);
    } catch (error: unknown) {
      console.error("Fehler beim Laden der Projekte:", error);
    }
  }, []);

  const loadDataSources = useCallback(async (): Promise<void> => {
    try {
      const { data, error } = await databaseClient.fetchDataSources();

      if (error) throw error;

      // Load project assignments for each data source
      const sourcesWithProjects = await Promise.all(
        (data ?? []).map(async (source): Promise<DataSourceWithProjects> => {
          const { data: assignments } = await databaseClient.fetchDataSourceAssignments(source.id);

          return {
            ...source,
            assigned_projects: assignments?.map((assignment) => assignment.project_id) ?? [],
          };
        })
      );

      setDataSources(sourcesWithProjects);
    } catch (error: unknown) {
      toast.error("Fehler beim Laden der Datenquellen");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
    void loadProjects();
    void loadDataSources();
  }, [checkAuth, loadProjects, loadDataSources]);

  const handleOpenDialog = (source?: DataSourceWithProjects) => {
    if (source) {
      setEditingSource(source);
      setFormData(mapDataSourceToFormData(source));
      setSelectedProjects(source.assigned_projects ?? []);
    } else {
      setEditingSource(null);
      setFormData(createInitialDataSourceFormData());
      setSelectedProjects([]);
    }
    setIsDialogOpen(true);
  };

  useEffect(() => {
    if (!isDialogOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isDialogOpen]);

  const handleSave = async () => {
    if (!formData.name) {
      toast.error("Bitte geben Sie einen Namen für die Datenquelle ein.");
      return;
    }

    const hasAuth = formData.api_key || (formData.username && formData.password) || formData.auth_type === 'oauth2';

    if (!hasAuth) {
      toast.error("Bitte geben Sie Zugangsdaten (API Token oder Benutzername/Passwort) an.");
      return;
    }

    try {
      const { data: { user } } = await databaseClient.getUser();
      if (!user) throw new Error("Nicht authentifiziert");

      let sourceId: string;

      const additionalConfig = buildDataSourceAdditionalConfig(formData);

      const baseData: TablesInsert<"data_sources"> = {
        name: formData.name,
        source_type: formData.source_type,
        api_url: formData.api_url || null,
        api_key: formData.api_key || null,
        username: formData.username || null,
        password: formData.password || null,
        email: formData.email || null,
        auth_type: formData.auth_type,
        is_active: formData.is_active,
        is_global: formData.is_global,
        additional_config: additionalConfig,
        user_id: user.id,
      };

      if (editingSource) {
        const { error } = await databaseClient.updateDataSource(editingSource.id, {
          ...baseData,
          user_id: editingSource.user_id,
        });

        if (error) throw error;
        sourceId = editingSource.id;

        // Delete existing project assignments
        await databaseClient.deleteDataSourceProjectAssignments(sourceId);
        
        toast.success("Datenquelle aktualisiert");
      } else {
        const { data, error } = await databaseClient.insertDataSource(baseData);

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

        const { error: assignmentError } = await databaseClient.insertDataSourceProjectAssignments(assignments);

        if (assignmentError) throw assignmentError;
      }

      setIsDialogOpen(false);
      setFormData(createInitialDataSourceFormData());
      await loadDataSources();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error) || "Fehler beim Speichern");
      console.error(error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await databaseClient.deleteDataSource(id);

      if (error) throw error;
      toast.success("Datenquelle gelöscht");
      await loadDataSources();
    } catch (error: unknown) {
      toast.error("Fehler beim Löschen");
      console.error(error);
    }
  };

  useEffect(() => {
    if (formData.is_global) {
      setSelectedProjects([]);
    }
  }, [formData.is_global]);

  if (loaderVisible) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center p-6">
        <DataFlowLoader size="lg" />
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
            {dataSources.map((source) => (
              <DataSourceCard
                key={source.id}
                source={source}
                onEdit={handleOpenDialog}
                onDelete={handleDelete}
              />
            ))}

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

      <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="max-w-5xl max-h-[90vh] overflow-y-auto"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {editingSource ? "Datenquelle bearbeiten" : "Neue Datenquelle"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Geben Sie die Verbindungsdetails für die neue oder bestehende Datenquelle ein.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="space-y-6">
              <BasicInfoStep
                formData={formData}
                setFormData={setFormData}
                sourceTypeOptions={sourceTypeOptions}
                ref={nameInputRef}
              />
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => handleDialogOpenChange(false)}
              className="rounded-full"
            >
              Abbrechen
            </Button>
            <Button onClick={handleSave} className="rounded-full px-5">
              Speichern
            </Button>
          </DialogFooter>        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DataSources;