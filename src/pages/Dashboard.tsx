import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import UserMenu from "@/components/UserMenu";
import AccountDialog from "@/components/dialogs/AccountDialog";
import AddMigrationDialog from "@/components/dialogs/AddMigrationDialog";
import MigrationDetails, { type MigrationDetailsRef } from "@/components/MigrationDetails";
import DataFlowLoader from "@/components/DataFlowLoader";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Workflow,
  ArrowRight,
  Settings,
  MessageSquare,
  MessageCircle,
  Loader2,
  ShieldCheck,
  Package,
  CheckCircle2,
  XCircle,
  Circle,
  Clock,
  Cpu,
  Activity as ActivityIcon,
  TrendingUp,
  TrendingDown,
  Network,
  Zap
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { toast } from "sonner";
import { databaseClient } from "@/api/databaseClient";
import { useMinimumLoader } from "@/hooks/useMinimumLoader";
import type { Activity as ActivityType } from "@/components/ActivityTimeline";
import type { RawActivityRecord } from "@/components/migration/migrationDetails.types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type { MigrationStatus, NewMigrationInput } from "@/types/migration";
import {
  AUTH_DETAIL_CREDENTIALS,
  AUTH_DETAIL_TOKEN,
  CONNECTOR_AUTH_LABEL,
  CONNECTOR_ENDPOINT_LABEL,
} from "@/constants/migrations";
import { duplicateMigration } from "@/lib/migrationDuplication";
import { cn } from "@/lib/utils";
import { logout } from "@/auth/keycloakClient";
import { Progress } from "@/components/ui/progress";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";

const deriveMigrationStatus = (migration: any): MigrationStatus => {
  const progress = Number(migration?.progress ?? 0);

  if (progress >= 100) {
    return "completed";
  }

  if (progress > 0) {
    return "running";
  }

  return "not_started";
};

const normalizeActivityRecord = (activity: RawActivityRecord): ActivityType => {
  const rawTimestamp = activity?.timestamp ?? activity?.created_at ?? "";

  let timestamp = "";
  if (typeof rawTimestamp === "string" && rawTimestamp.trim() !== "") {
    timestamp = rawTimestamp;
  } else if (rawTimestamp instanceof Date) {
    timestamp = rawTimestamp.toISOString();
  } else if (rawTimestamp) {
    const parsed = new Date(rawTimestamp);
    timestamp = Number.isNaN(parsed.getTime()) ? String(rawTimestamp) : parsed.toISOString();
  } else {
    timestamp = new Date().toISOString();
  }

  return {
    id: activity?.id ?? `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: (activity?.type ?? "info") as ActivityType["type"],
    title: activity?.title ?? "",
    timestamp,
  };
};

const MIGRATIONS_PAGE_SIZE = 15;

const Dashboard = () => {
  const navigate = useNavigate();
  const { migrationId, projectId } = useParams<{ migrationId?: string; projectId?: string }>();
  const [selectedMigration, setSelectedMigration] = useState<string | null>(migrationId || null);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'workflow' | 'mapping' | 'enhancement' | 'config'>('chat');
  
  const [migrations, setMigrations] = useState<any[]>([]);
  const [standaloneMigrations, setStandaloneMigrations] = useState<any[]>([]);
  const [allProjects, setAllProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [migrationToDelete, setMigrationToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isNotesPopoverOpen, setIsNotesPopoverOpen] = useState(false);
  const [migrationNotes, setMigrationNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [projectIdForNewMigration, setProjectIdForNewMigration] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const loaderVisible = useMinimumLoader(loading || transitioning || duplicating, 1000);
  const migrationDetailsRef = useRef<MigrationDetailsRef>(null);
  const [processingMigrationId, setProcessingMigrationId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Lazy loading state for standalone migrations
  const [hasMoreMigrations, setHasMoreMigrations] = useState(true);
  const [isLoadingMoreMigrations, setIsLoadingMoreMigrations] = useState(false);
  const [totalMigrationsCount, setTotalMigrationsCount] = useState(0);
  const migrationsPageRef = useRef(0);

  const [dashboardStats, setDashboardStats] = useState<{
    total_migrations: number;
    completed_migrations: number;
    total_objects_migrated: number;
    avg_automation_rate: number;
    data_reliability_score: number;
    vendor_lockins_prevented: number;
    activity_graph: any[];
    total_steps_executed: number;
  } | null>(null);

  const loadDashboardStats = async () => {
    try {
      const response = await fetch("/api/stats/dashboard");
      if (response.ok) {
        const data = await response.json();
        setDashboardStats(data);
      }
    } catch (error) {
      console.error("Fehler beim Laden der Dashboard-Statistiken:", error);
    }
  };

  // Check auth and load project data
  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    setSelectedMigration(migrationId ?? null);
    // When migration changes, default back to chat view
    setActiveView('chat');
  }, [migrationId]);

  const checkAuth = async () => {
    const { data: { session } } = await databaseClient.getSession();
    if (!session) {
      navigate("/");
    }
  };

  const loadAllData = async () => {
    try {
      setLoading(true);
      await loadDashboardStats();
      
      // Load all projects
      const { data: projectsData, error: projectsError } = await databaseClient.fetchProjects();

      let projects = projectsData || [];
      if (projectsError) {
        // HACK: Gracefully handle 500 error on project fetch, assuming it means "no projects".
        if (projectsError.message.includes("500")) {
          console.warn("Server returned 500 when fetching projects, treating as empty list.");
          projects = [];
        } else {
          throw projectsError;
        }
      }
      setAllProjects(projects);

      // Load all migrations with project_id
      const allMigrationsWithProjects: any[] = [];
      for (const project of projects) {
        const { data: migrationsData, error: migrationsError } = await databaseClient.fetchMigrationsByProject(project.id);

        if (migrationsError) throw migrationsError;
        const migrationsWithDetails = await loadMigrationDetails(migrationsData || [], project.id);
        allMigrationsWithProjects.push(...migrationsWithDetails);
      }
      setMigrations(allMigrationsWithProjects);

      // Load standalone migrations with pagination (initial load)
      migrationsPageRef.current = 0;
      const { data: standaloneData, error: standaloneError, count } = await databaseClient.fetchStandaloneMigrationsPaginated(MIGRATIONS_PAGE_SIZE, 0);

      if (standaloneError) throw standaloneError;

      setTotalMigrationsCount(count || 0);
      setHasMoreMigrations((standaloneData?.length || 0) === MIGRATIONS_PAGE_SIZE);
      
      const standaloneWithDetails = await loadMigrationDetails(standaloneData || [], null);
      setStandaloneMigrations(standaloneWithDetails);
      migrationsPageRef.current = 1;
    } catch (error: any) {
      toast.error("Fehler beim Laden der Daten");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadMigrationDetails = useCallback(async (migrationsData: any[], projectId: string | null) => {
    return await Promise.all(
      migrationsData.map(async (migration) => {
        const { data: activitiesData } = await databaseClient.fetchMigrationActivities(migration.id);

        const activities = (activitiesData || []).map((a) => normalizeActivityRecord(a as RawActivityRecord));
        const workflowState = migration.workflow_state;

        return {
          id: migration.id,
          name: migration.name,
          progress: migration.progress,
          sourceSystem: migration.source_system,
          targetSystem: migration.target_system,
          sourceUrl: migration.source_url,
          targetUrl: migration.target_url,
          inConnector: migration.in_connector,
          inConnectorDetail: migration.in_connector_detail,
          outConnector: migration.out_connector,
          outConnectorDetail: migration.out_connector_detail,
          objectsTransferred: migration.objects_transferred,
          mappedObjects: migration.mapped_objects,
          projectId: projectId,
          activities,
          notes: migration.notes ?? "",
          status: (migration.step_status === 'running' || migration.step_status === 'pending') 
            ? 'processing' 
            : (migration.step_status === 'failed' ? 'paused' : (migration.status === 'completed' ? 'completed' : 'not_started')),
          workflowState: migration.workflow_state,
          current_step: migration.current_step,
          step_status: migration.step_status,
          consultant_status: migration.consultant_status,
          scopeConfig: migration.scope_config,
        };
      }),
    );
  }, []);

  // Optimized refresh for only the current migration
  const refreshCurrentMigration = useCallback(async () => {
    if (!selectedMigration) return;
    
    try {
      // Load only the selected migration
      const { data: migrationData, error: migrationError } = await databaseClient.fetchMigrationById(selectedMigration);

      if (migrationError) throw migrationError;

      const details = await loadMigrationDetails([migrationData], migrationData.project_id);
      const updatedMigration = details[0];

      // Update only the affected migration in state
      if (migrationData.project_id) {
        setMigrations(prev => 
          prev.map(m => m.id === selectedMigration ? updatedMigration : m)
        );
      } else {
        setStandaloneMigrations(prev => 
          prev.map(m => m.id === selectedMigration ? updatedMigration : m)
        );
      }
    } catch (error: any) {
      console.error("Fehler beim Aktualisieren der Migration:", error);
    }
  }, [selectedMigration, loadMigrationDetails]);

  const handleStepRunningChange = (migrationId: string, isRunning: boolean) => {
    setProcessingMigrationId(isRunning ? migrationId : null);
  };

  useEffect(() => {
    const stopPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };

    if (processingMigrationId) {
      pollingIntervalRef.current = setInterval(() => {
        refreshCurrentMigration();
      }, 3000);
    } else {
      stopPolling();
    }

    return stopPolling;
  }, [processingMigrationId, refreshCurrentMigration]);

  // Load more migrations (infinite scroll)
  const handleLoadMoreMigrations = useCallback(async () => {
    if (isLoadingMoreMigrations || !hasMoreMigrations) return;

    setIsLoadingMoreMigrations(true);
    try {
      const offset = migrationsPageRef.current * MIGRATIONS_PAGE_SIZE;
      const { data: standaloneData, error: standaloneError } = await databaseClient.fetchStandaloneMigrationsPaginated(MIGRATIONS_PAGE_SIZE, offset);

      if (standaloneError) throw standaloneError;

      const newMigrationsWithDetails = await loadMigrationDetails(standaloneData || [], null);
      setStandaloneMigrations(prev => [...prev, ...newMigrationsWithDetails]);
      setHasMoreMigrations((standaloneData?.length || 0) === MIGRATIONS_PAGE_SIZE);
      migrationsPageRef.current++;
    } catch (error: any) {
      console.error("Fehler beim Laden weiterer Migrationen:", error);
    } finally {
      setIsLoadingMoreMigrations(false);
    }
  }, [isLoadingMoreMigrations, hasMoreMigrations, loadMigrationDetails]);

  const handleSaveNotes = async () => {
    if (!currentMigration) return;

    try {
      setIsSavingNotes(true);
      const { error } = await databaseClient.updateMigration(currentMigration.id, { notes: migrationNotes });

      if (error) throw error;

      toast.success("Anmerkungen gespeichert");
      await refreshCurrentMigration();
      setIsNotesPopoverOpen(false);
    } catch (error) {
      console.error("Fehler beim Speichern der Anmerkungen:", error);
      toast.error("Anmerkungen konnten nicht gespeichert werden");
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleLogout = async () => {
    try {
      setTransitioning(true);
      await databaseClient.signOut();
      await logout();
      toast.success("Erfolgreich abgemeldet");
      navigate("/");
    } catch (error) {
      toast.error("Abmeldung fehlgeschlagen");
      console.error(error);
    } finally {
      setTransitioning(false);
    }
  };

  const handleAddMigration = async (migrationData: Partial<NewMigrationInput>) => {
    try {
      const { data: { user } } = await databaseClient.getUser();
      if (!user) throw new Error("Nicht authentifiziert");

      const name = migrationData.name || "Neue Migration";
      const sourceUrl = migrationData.sourceUrl || "";
      const targetUrl = migrationData.targetUrl || "";
      const sourceSystem = migrationData.sourceSystem || "TBD";
      const targetSystem = migrationData.targetSystem || "TBD";
      
      const targetAuthDetail = AUTH_DETAIL_TOKEN;

      const { data: migration, error: migrationError } = await databaseClient.insertMigration({
        user_id: user.id,
        project_id: projectIdForNewMigration,
        name,
        source_system: sourceSystem,
        target_system: targetSystem,
        source_url: sourceUrl,
        target_url: targetUrl,
        in_connector: CONNECTOR_ENDPOINT_LABEL,
        in_connector_detail: sourceUrl || "TBD",
        out_connector: CONNECTOR_AUTH_LABEL,
        out_connector_detail: targetAuthDetail,
        status: "processing",
        scope_config: migrationData.scopeConfig,
      });

      if (migrationError) throw migrationError;

      if (migrationData.sourceAuth && migrationData.targetAuth) {
          const sourceConnectorPayload = {
            migration_id: migration.id,
            api_url: sourceUrl,
            auth_type: "api_key",
            api_key: migrationData.sourceAuth.apiToken ?? null,
            username: migrationData.sourceAuth.email ?? null,
          };
    
          const targetConnectorPayload = {
            migration_id: migration.id,
            api_url: targetUrl,
            auth_type: "api_key",
            api_key: migrationData.targetAuth.apiToken ?? null,
            username: migrationData.targetAuth.email ?? null,
          };
    
          const { error: connectorError } = await databaseClient.insertConnectors([
            { ...sourceConnectorPayload, connector_type: 'in' },
            { ...targetConnectorPayload, connector_type: 'out' },
          ]);
    
          if (connectorError) throw connectorError;
      }

      // Create initial activity
        await databaseClient.insertMigrationActivity({
          migration_id: migration.id,
          type: 'info',
          title: 'Neues Migrationsprojekt erstellt',
          timestamp: new Date().toISOString(),
        });

      toast.success(`Migration "${name}" erstellt`);
      setProjectIdForNewMigration(null);
      
      // Navigate to the new migration
      if (projectIdForNewMigration) {
        navigate(`/projects/${projectIdForNewMigration}/migration/${migration.id}`);
      } else {
        navigate(`/migration/${migration.id}`);
      }
      
      loadAllData();
      return migration;
    } catch (error: any) {
      toast.error(error.message || "Fehler beim Erstellen der Migration");
      console.error(error);
      return null;
    }
  };

  const handleDeleteMigration = (migrationId: string) => {
    const migration = [...migrations, ...standaloneMigrations].find((m) => m.id === migrationId);
    if (migration) {
      setMigrationToDelete({ id: migration.id, name: migration.name });
      setShowDeleteDialog(true);
    } else {
      toast.error("Zu löschende Migration nicht gefunden.");
    }
  };

  const confirmDeleteMigration = async () => {
    if (!migrationToDelete) return;

    try {
      const { error } = await databaseClient.deleteMigration(migrationToDelete.id);

      if (error) throw error;

      if (selectedMigration === migrationToDelete.id) {
        setSelectedMigration(null);
        navigate("/migrations");
      }
      
      toast.success(`Migration "${migrationToDelete.name}" gelöscht`);
      loadAllData();
    } catch (error: any) {
      toast.error("Fehler beim Löschen der Migration");
      console.error(error);
    } finally {
      setShowDeleteDialog(false);
      setMigrationToDelete(null);
    }
  };

  const handleDuplicateMigration = async (migrationId: string) => {
    try {
      setDuplicating(true);
      const existingNames = [...migrations, ...standaloneMigrations].map((migration) => migration.name);
      const duplicated = await duplicateMigration(migrationId, { existingNames });

      toast.success(`Migration "${duplicated.name}" dupliziert`);
      await loadAllData();

      if (duplicated.project_id) {
        navigate(`/projects/${duplicated.project_id}/migration/${duplicated.id}`);
      } else {
        navigate(`/migration/${duplicated.id}`);
      }
    } catch (error: any) {
      toast.error(error?.message ?? "Migration konnte nicht dupliziert werden");
      console.error(error);
    } finally {
      setDuplicating(false);
    }
  };

  const currentMigration = selectedMigration 
    ? [...migrations, ...standaloneMigrations].find((m) => m.id === selectedMigration)
    : null;

  // Header Info Memoized
  const headerInfo = useMemo(() => {
    if (!currentMigration) return null;

    const totalSteps = 8;
    const rawStep = currentMigration.current_step || 0;
    const isStepRunning = currentMigration.step_status === 'running' || currentMigration.step_status === 'pending';
    const hasCurrentStepFailed = currentMigration.step_status === 'failed';
    
    // Calculate completed steps
    const completedCount = (isStepRunning || hasCurrentStepFailed) ? Math.max(0, rawStep - 1) : rawStep;
    const progress = (completedCount / totalSteps) * 100;
    
    // Determine the current display step (clamped to range 1-10)
    const currentStepNumber = completedCount + 1 > totalSteps ? totalSteps : completedCount + 1;
    const activeStep = AGENT_WORKFLOW_STEPS[currentStepNumber - 1];

    if (rawStep === 0 && !isStepRunning && currentMigration.status !== 'not_started') {
      return {
        progress: 0,
        step: {
          number: 0,
          title: "Einrichtung",
          isRunning: false,
          hasFailed: false,
          label: "Onboarding"
        }
      };
    }

    const title = activeStep?.title || (completedCount === totalSteps ? "Abgeschlossen" : "Bereit");

    return {
      progress,
      step: {
        number: currentStepNumber,
        title,
        isRunning: isStepRunning,
        hasFailed: hasCurrentStepFailed,
        label: activeStep?.phase || "Phase"
      }
    };
  }, [currentMigration]);

  const isMappingEnabled = useMemo(() => {
    if (!currentMigration) return false;
    const rawStep = currentMigration.current_step || 0;
    const isStepRunning = currentMigration.step_status === 'running' || currentMigration.step_status === 'pending';
    const hasCurrentStepFailed = currentMigration.step_status === 'failed';
    const completedCount = (isStepRunning || hasCurrentStepFailed) ? Math.max(0, rawStep - 1) : rawStep;
    return completedCount >= 5;
  }, [currentMigration]);

  const isEnhancementEnabled = useMemo(() => {
    if (!currentMigration) return false;
    const rawStep = currentMigration.current_step || 0;
    const isStepRunning = currentMigration.step_status === 'running' || currentMigration.step_status === 'pending';
    const hasCurrentStepFailed = currentMigration.step_status === 'failed';
    const completedCount = (isStepRunning || hasCurrentStepFailed) ? Math.max(0, rawStep - 1) : rawStep;
    return completedCount >= 6;
  }, [currentMigration]);

  const isStep6Verified = useMemo(() => {
    if (!currentMigration?.workflowState?.nodes) return false;
    const step6Node = currentMigration.workflowState.nodes.find((n: any) => n.id === "mapping-verification" || n.id === "step-6");
    if (!step6Node) return false;
    
    // Check for success: status='done' AND no error
    return step6Node.status === 'done' && step6Node.agentResult && !step6Node.agentResult.error;
  }, [currentMigration]);

  const isStep7Verified = useMemo(() => {
    if (!currentMigration?.workflowState?.nodes) return false;
    const step7Node = currentMigration.workflowState.nodes.find((n: any) => n.id === "quality-enhancement" || n.id === "step-7");
    if (!step7Node) return false;
    
    return step7Node.status === 'done' && step7Node.agentResult && !step7Node.agentResult.error;
  }, [currentMigration]);

  const configVerificationStatus = useMemo(() => {
    if (!currentMigration?.workflowState?.nodes) return 'unverified';
    
    const step1Node = currentMigration.workflowState.nodes.find((n: any) => n.id === "system-detection" || n.id === "step-1");
    const step2Node = currentMigration.workflowState.nodes.find((n: any) => n.id === "auth-flow" || n.id === "step-2");

    // Check Step 2 (Auth)
    if (step2Node?.status === 'done') {
        if (step2Node.agentResult && !step2Node.agentResult.error) {
            return 'verified';
        }
        return 'failed';
    }

    // Check Step 1 (System)
    if (step1Node?.status === 'done') {
         if (step1Node.agentResult && step1Node.agentResult.error) {
             return 'failed';
         }
         // Step 1 done & success, Step 2 not done -> Unverified (Auth not checked yet)
         return 'unverified';
    }

    // Neither run
    return 'unverified';
  }, [currentMigration]);



  // Load notes when current migration changes
  useEffect(() => {
    if (currentMigration) {
      setMigrationNotes(currentMigration.notes || "");
    }
  }, [currentMigration]);

  if (loaderVisible) {
    return (
      <div className="app-shell flex h-screen items-center justify-center p-6 overflow-hidden">
        <DataFlowLoader size="lg" message={duplicating ? "Dupliziere Migration..." : undefined} />
      </div>
    );
  }

  const standaloneMigrationsWithProcessingStatus = standaloneMigrations.map(m => ({
    ...m,
    status: processingMigrationId === m.id ? 'processing' : m.status,
  }));

  const migrationsWithProcessingStatus = migrations.map(m => ({
    ...m,
    status: processingMigrationId === m.id ? 'processing' : m.status,
  }));

  return (
    <div className="app-shell flex h-screen flex-col px-6 pt-6 pb-6 overflow-hidden">
      <div className="flex flex-1 gap-6 min-h-0">
        <Sidebar
          projects={allProjects}
          projectMigrations={migrationsWithProcessingStatus}
          standaloneMigrations={standaloneMigrationsWithProcessingStatus}
          selectedMigration={selectedMigration}
          onSelectMigration={(id) => {
            const migration = [...migrations, ...standaloneMigrations].find(m => m.id === id);
            if (migration && migration.projectId) {
              navigate(`/projects/${migration.projectId}/migration/${id}`);
            } else {
              navigate(`/migration/${id}`);
            }
          }}
          onNewMigration={() => {
            setProjectIdForNewMigration(null);
            setShowAddDialog(true);
          }}
          onNewProjectMigration={(projectId) => {
            setProjectIdForNewMigration(projectId);
            setShowAddDialog(true);
          }}
          onDeleteMigration={handleDeleteMigration}
          onDuplicateMigration={handleDuplicateMigration}
          onLoadMoreMigrations={handleLoadMoreMigrations}
          hasMoreMigrations={hasMoreMigrations}
          isLoadingMoreMigrations={isLoadingMoreMigrations}
          totalMigrationsCount={totalMigrationsCount}
        />

        <div className={cn("flex flex-1 flex-col min-h-0", currentMigration ? "gap-0" : "gap-6")}>
          {currentMigration ? (
            <div className="app-surface flex flex-1 flex-col overflow-hidden rounded-3xl">
              <header
                data-sidebar-anchor
                className="flex items-center justify-between border-b px-6 py-4 shrink-0"
              >
                <div className="flex items-center gap-6 flex-1 min-w-0">
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="inline-flex items-center gap-2 rounded-full bg-foreground/5 px-4 py-1 text-sm text-muted-foreground whitespace-nowrap">
                      Migration
                    </div>
                    <div className="text-base font-semibold text-foreground truncate max-w-[200px]">
                      {currentMigration.name}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
                      <span>{currentMigration.sourceSystem}</span>
                      <span>→</span>
                      <span>{currentMigration.targetSystem}</span>
                    </div>
                  </div>

                  <div className="h-8 w-px bg-border/60 shrink-0" />

                  {/* Progress & Step Info centered in header */}
                  {headerInfo && (
                    <div className="flex flex-1 items-center gap-6 min-w-0 max-w-xl">
                      <div className="flex flex-col gap-0.5 min-w-0 w-full">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-bold text-foreground whitespace-nowrap">
                            Schritt {headerInfo.step.number}:
                          </span>
                          <span className="text-sm font-medium text-muted-foreground truncate">
                            {headerInfo.step.title}
                          </span>
                          {headerInfo.step.isRunning && (
                            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <Progress value={headerInfo.progress} className="h-1.5 flex-1" />
                          <span className="text-[11px] font-bold text-primary tabular-nums min-w-[30px]">
                            {Math.round(headerInfo.progress)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <Button
                    variant={activeView === 'chat' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => setActiveView('chat')}
                    className="h-8 w-8"
                    title="Chat"
                  >
                    <MessageCircle className={cn("h-4 w-4 transition-colors", activeView === 'chat' && "text-primary")} />
                  </Button>
                  <Button
                    variant={activeView === 'workflow' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => setActiveView('workflow')}
                    className="h-8 w-8"
                    title="Erkenntnisse"
                  >
                    <Workflow className={cn("h-4 w-4 transition-colors", activeView === 'workflow' && "text-primary")} />
                  </Button>
                  <Button
                    variant={activeView === 'mapping' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => setActiveView('mapping')}
                    className="h-8 w-8 relative"
                    disabled={!isMappingEnabled}
                    title={isMappingEnabled ? (isStep6Verified ? "Mappings - verifiziert" : "Mappings") : "Mapping erst nach Abschluss von Schritt 4 verfügbar"}
                  >
                    <Network className={cn("h-4 w-4 transition-colors", activeView === 'mapping' && "text-primary")} />
                    {isMappingEnabled && (
                      <div className="absolute -top-1 -right-1 pointer-events-none bg-background rounded-full ring-2 ring-background">
                         {isStep6Verified ? (
                           <CheckCircle2 className="h-3 w-3 text-green-500 fill-background" /> 
                         ) : (
                           <XCircle className="h-3 w-3 text-red-500 fill-background" />
                         )}
                      </div>
                    )}
                  </Button>
                  <Button
                    variant={activeView === 'enhancement' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => setActiveView('enhancement')}
                    className="h-8 w-8 relative"
                    disabled={!isEnhancementEnabled}
                    title={isEnhancementEnabled ? (isStep7Verified ? "Enhancements - abgeschlossen" : "Enhancements") : "Enhancements erst nach Mapping verfügbar"}
                  >
                    <Zap className={cn("h-4 w-4 transition-colors", activeView === 'enhancement' && "text-primary")} />
                    {isEnhancementEnabled && (
                      <div className="absolute -top-1 -right-1 pointer-events-none bg-background rounded-full ring-2 ring-background">
                         {isStep7Verified ? (
                           <CheckCircle2 className="h-3 w-3 text-green-500 fill-background" /> 
                         ) : (
                           <Circle className="h-3 w-3 text-muted-foreground fill-background" />
                         )}
                      </div>
                    )}
                  </Button>
                  <Button
                    variant={activeView === 'config' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => setActiveView('config')}
                    className="h-8 w-8 relative"
                    title={configVerificationStatus === 'verified' ? "Konfiguration - verifiziert" : "Konfiguration"}
                  >
                    <Settings className={cn("h-4 w-4 transition-colors", activeView === 'config' && "text-primary")} />
                    <div className="absolute -top-1 -right-1 pointer-events-none bg-background rounded-full ring-2 ring-background">
                        {configVerificationStatus === 'verified' ? (
                          <CheckCircle2 className="h-3 w-3 text-green-500 fill-background" /> 
                        ) : configVerificationStatus === 'failed' ? (
                          <XCircle className="h-3 w-3 text-red-500 fill-background" />
                        ) : (
                          <Circle className="h-3 w-3 text-muted-foreground fill-background" />
                        )}
                    </div>
                  </Button>
                  <Popover open={isNotesPopoverOpen} onOpenChange={setIsNotesPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                      >
                        <MessageSquare className={cn("h-4 w-4", migrationNotes && migrationNotes.trim().length > 0 && "text-primary")} />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[500px]" align="end">
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-medium text-sm mb-2">Anmerkungen</h4>
                          <Textarea
                            value={migrationNotes}
                            onChange={(e) => setMigrationNotes(e.target.value)}
                            placeholder="Beschreibe hier dein Prompt: Ziel der Migration, relevante Randbedingungen und gewünschte Unterstützung."
                            rows={6}
                            className="min-h-[120px]"
                          />
                        </div>
                        <Button 
                          onClick={handleSaveNotes} 
                          disabled={migrationNotes === (currentMigration?.notes || "") || isSavingNotes} 
                          size="sm" 
                          className="w-full"
                        >
                          {isSavingNotes && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Speichern
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <UserMenu
                    onSettingsClick={() => setShowAccountDialog(true)}
                    onLogout={handleLogout}
                  />
                </div>
              </header>

              <div className="flex-1 overflow-hidden">
                <MigrationDetails
                  ref={migrationDetailsRef}
                  project={currentMigration}
                  onRefresh={refreshCurrentMigration}
                  onStepRunningChange={(isRunning) => handleStepRunningChange(currentMigration.id, isRunning)}
                  activeView={activeView}
                  onViewChange={setActiveView}
                />
              </div>
            </div>
          ) : (
            <>
              <header
                data-sidebar-anchor
                className="app-surface flex items-center justify-between rounded-3xl px-6 py-5"
              >
                <div>
                  <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
                  <p className="text-sm text-muted-foreground">Eine kompakte Übersicht deiner Migrationen.</p>
                </div>
                <UserMenu
                  onSettingsClick={() => setShowAccountDialog(true)}
                  onLogout={handleLogout}
                />
              </header>

              <div className="flex-1 overflow-hidden">
                <div className="app-surface flex h-full flex-col rounded-3xl px-8 py-6 overflow-hidden">
                  {/* STICKY: Activity Chart Section */}
                  <div className="shrink-0 pb-6 border-b border-border/20">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Aktivitätsübersicht
                      </h2>
                      <span className="text-xs text-muted-foreground">Letzte 30 Tage</span>
                    </div>
                    
                    <div className="h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={dashboardStats?.activity_graph || []}>
                          <defs>
                            <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis 
                            dataKey="date" 
                            axisLine={false} 
                            tickLine={false}
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            interval="preserveStartEnd"
                          />
                          <YAxis hide />
                          <Tooltip 
                            content={({ active, payload }) => (
                              active && payload?.[0] ? (
                                <div className="bg-popover px-3 py-2 rounded-lg shadow-lg border">
                                  <p className="text-xs text-muted-foreground">{payload[0].payload.date}</p>
                                  <p className="text-sm font-semibold">{payload[0].value} Aktivitäten</p>
                                </div>
                              ) : null
                            )}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="steps" 
                            stroke="hsl(var(--primary))" 
                            fill="url(#activityGradient)" 
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* STICKY: Key Metrics Grid */}
                  <div className="shrink-0 grid grid-cols-3 gap-6 py-6 border-b border-border/20">
                    {/* Vendor Lock-Ins Prevented */}
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-emerald-500/10">
                        <ShieldCheck className="h-5 w-5 text-emerald-500" />
                      </div>
                      <div>
                        <div className="flex items-baseline gap-2">
                          <p className="text-2xl font-semibold tabular-nums">
                            {dashboardStats?.vendor_lockins_prevented ?? 0}
                          </p>
                        </div>
                        <p className="text-sm text-muted-foreground">Vendor Lock-Ins verhindert</p>
                      </div>
                    </div>

                    {/* Total Migrated Objects */}
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-primary/10">
                        <Package className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-2xl font-semibold tabular-nums">
                          {(dashboardStats?.total_objects_migrated ?? 0).toLocaleString('de-DE')}
                        </p>
                        <p className="text-sm text-muted-foreground">Migrierte Objekte</p>
                      </div>
                    </div>

                    {/* Completed Migrations */}
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-emerald-500/10">
                        <ShieldCheck className="h-5 w-5 text-emerald-500" />
                      </div>
                      <div>
                        <div className="flex items-baseline gap-2">
                          <p className="text-2xl font-semibold tabular-nums">
                            {dashboardStats?.completed_migrations ?? 0}
                          </p>
                          <span className="text-sm text-muted-foreground">
                            / {dashboardStats?.total_migrations ?? 0}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">Abgeschlossene Migrationen</p>
                      </div>
                    </div>

                    {/* Average Duration */}
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-amber-500/10">
                        <Clock className="h-5 w-5 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-2xl font-semibold tabular-nums">
                          {(dashboardStats?.total_steps_executed ?? 0) * 8}h
                        </p>
                        <p className="text-sm text-muted-foreground">Eingesparte Arbeitszeit</p>
                      </div>
                    </div>

                    {/* Mapping Automation Rate */}
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-accent/30">
                        <Cpu className="h-5 w-5 text-accent-foreground" />
                      </div>
                      <div>
                        <div className="flex items-baseline gap-2">
                          <p className="text-2xl font-semibold tabular-nums">
                            {dashboardStats?.avg_automation_rate ?? 0}%
                          </p>
                        </div>
                        <p className="text-sm text-muted-foreground">KI-Automatisierungsrate</p>
                      </div>
                    </div>

                    {/* Data Reliability Score */}
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-primary/10">
                        <ActivityIcon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-baseline gap-2">
                          <p className="text-2xl font-semibold tabular-nums">
                            {dashboardStats?.data_reliability_score ?? 0}%
                          </p>
                        </div>
                        <p className="text-sm text-muted-foreground">Datenqualitäts-Score</p>
                      </div>
                    </div>
                  </div>

                  {/* SCROLLABLE: Recent Activities List */}
                  <div className="flex-1 min-h-0 pt-6 flex flex-col">
                    <h2 className="shrink-0 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">
                      Letzte Aktivitäten
                    </h2>
                    
                    {[...migrations, ...standaloneMigrations].length > 0 ? (
                      <div className="flex-1 min-h-0 overflow-y-auto -mx-4 px-4">
                        <div className="space-y-1">
                        {[...migrations, ...standaloneMigrations]
                          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                          .slice(0, 6)
                          .map((migration) => (
                            <button
                              key={migration.id}
                              onClick={() => {
                                if (migration.projectId) {
                                  navigate(`/projects/${migration.projectId}/migration/${migration.id}`);
                                } else {
                                  navigate(`/migration/${migration.id}`);
                                }
                              }}
                              className="w-full flex items-center justify-between py-3 px-4 -mx-4 rounded-lg hover:bg-foreground/5 transition-colors group"
                            >
                              <div className="flex items-center gap-4">
                                <span className="font-medium">{migration.name}</span>
                                <span className="text-sm text-muted-foreground">
                                  {migration.sourceSystem} → {migration.targetSystem}
                                </span>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-foreground/50 rounded-full transition-all"
                                    style={{ width: `${migration.progress}%` }}
                                  />
                                </div>
                                <span className="text-sm font-medium tabular-nums w-10 text-right text-muted-foreground">
                                  {migration.progress}%
                                </span>
                                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Workflow className="h-8 w-8 text-muted-foreground/40 mb-4" />
                        <p className="text-muted-foreground">Keine Migrationen vorhanden</p>
                        <Button
                          onClick={() => setShowAddDialog(true)}
                          variant="ghost"
                          className="mt-4"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Migration erstellen
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <AccountDialog
        open={showAccountDialog}
        onOpenChange={setShowAccountDialog}
      />
      <AddMigrationDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSubmit={handleAddMigration}
      />
      
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Aktion kann nicht rückgängig gemacht werden. Die Migration "{migrationToDelete?.name}" wird permanent gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteMigration} className="bg-destructive hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Dashboard;