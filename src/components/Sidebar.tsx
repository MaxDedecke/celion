import {
  Plus,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Plug,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  MoreHorizontal,
  FolderOpen,
  Layers,
  Settings,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "./Logo";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LlmSettingsDialog } from "./dialogs/LlmSettingsDialog";

interface SidebarProps {
  projects: Array<{ id: string; name: string }>;
  projectMigrations?: Array<{ id: string; name: string; projectId: string | null; status?: string }>;
  standaloneMigrations?: Array<{ id: string; name: string; status?: string }>;
  selectedMigration?: string | null;
  onSelectMigration?: (id: string) => void;
  onNewMigration: () => void;
  onNewProjectMigration?: (projectId: string) => void;
  onDeleteMigration?: (id: string) => void;
  onDuplicateMigration?: (id: string) => void;
  onLoadMoreMigrations?: () => Promise<void>;
  hasMoreMigrations?: boolean;
  isLoadingMoreMigrations?: boolean;
  totalMigrationsCount?: number;
}

const Sidebar = ({
  projects,
  projectMigrations = [],
  standaloneMigrations = [],
  selectedMigration,
  onSelectMigration,
  onNewMigration,
  onNewProjectMigration,
  onDeleteMigration,
  onDuplicateMigration,
  onLoadMoreMigrations,
  hasMoreMigrations = false,
  isLoadingMoreMigrations = false,
  totalMigrationsCount = 0,
}: SidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [collapsedSize, setCollapsedSize] = useState<number>();
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const migrationsScrollRef = useRef<HTMLDivElement | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(projects.map(p => p.id)));
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const sidebarElement = sidebarRef.current;
    if (!sidebarElement) return;

    const container = sidebarElement.parentElement;
    if (!container) return;

    const anchorElement = container.querySelector<HTMLElement>("[data-sidebar-anchor]");
    if (!anchorElement) {
      setCollapsedSize(undefined);
      return;
    }

    const updateSize = () => {
      const nextSize = anchorElement.getBoundingClientRect().height;
      if (!Number.isNaN(nextSize) && nextSize > 0) {
        setCollapsedSize(nextSize);
      }
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => updateSize());
    resizeObserver.observe(anchorElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isCollapsed]);

  useEffect(() => {
    const scrollElement = migrationsScrollRef.current;
    if (!scrollElement || !onLoadMoreMigrations) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const nearBottom = scrollHeight - scrollTop - clientHeight < 100;

      if (nearBottom && hasMoreMigrations && !isLoadingMoreMigrations) {
        onLoadMoreMigrations();
      }
    };

    scrollElement.addEventListener('scroll', handleScroll);
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, [hasMoreMigrations, isLoadingMoreMigrations, onLoadMoreMigrations]);

  const collapsedDimension = collapsedSize ?? 80;
  const collapsedStyle = isCollapsed
    ? {
        width: `${collapsedDimension}px`,
        height: `${collapsedDimension}px`,
        minWidth: `${collapsedDimension}px`,
        minHeight: `${collapsedDimension}px`
      }
    : undefined;

  const toggleProject = (projectId: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId);
    } else {
      newExpanded.add(projectId);
    }
    setExpandedProjects(newExpanded);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={sidebarRef}
        style={collapsedStyle}
        className={cn(
          "transition-all duration-300 bg-gradient-to-b from-card via-card to-muted/30 border border-border/40 backdrop-blur-xl",
          isCollapsed
            ? "flex items-center justify-center self-start p-2 rounded-xl shadow-lg"
            : "flex h-full min-h-0 w-80 flex-col overflow-hidden pt-1 px-4 pb-3 rounded-2xl shadow-[0_18px_40px_-28px_hsl(var(--foreground)/0.22)]"
        )}
      >
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsCollapsed(false)}
                className="hover:bg-foreground/5"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={10}>
              <p>Sidebar öffnen</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <>
            <div className="mb-4 flex w-full items-center justify-between gap-2 flex-shrink-0">
              <Logo
                onClick={() => navigate("/dashboard")}
                className="cursor-pointer transition-all"
                imageClassName="h-14 w-14 pt-2"
                showText={false}
              />
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate("/data-sources")}
                      className="flex-shrink-0 hover:bg-foreground/5"
                    >
                      <Plug className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Datenquellen</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setLlmSettingsOpen(true)}
                      className="flex-shrink-0 hover:bg-foreground/5"
                    >
                      <Brain className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>KI-Einstellungen</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsCollapsed(true)}
                      className="flex-shrink-0 hover:bg-foreground/5"
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left" sideOffset={10}>
                    <p>Sidebar einklappen</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            <LlmSettingsDialog 
              open={llmSettingsOpen} 
              onOpenChange={setLlmSettingsOpen} 
            />

            <div className="h-px w-full bg-gradient-to-r from-transparent via-border/60 to-transparent mb-3 flex-shrink-0" />

            <nav className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex flex-col flex-shrink-0 min-h-[120px] max-h-[50%]">
                <Collapsible open={!projectsCollapsed} onOpenChange={(open) => setProjectsCollapsed(!open)} className="flex flex-col min-h-0">
                  <div className="flex items-center justify-between px-2 py-2 flex-shrink-0">
                    <h3 
                      className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => navigate("/projects")}
                    >
                      <FolderOpen className="h-3 w-3" />
                      Projekte
                    </h3>
                    <CollapsibleTrigger asChild>
                      <button
                        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                        aria-label={projectsCollapsed ? "Projekte ausklappen" : "Projekte einklappen"}
                      >
                        {projectsCollapsed ? (
                          <ChevronRight className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                    </CollapsibleTrigger>
                  </div>

                  <CollapsibleContent className="flex-1 overflow-y-auto min-h-0 animate-accordion-down data-[state=closed]:animate-accordion-up pr-2 mr-[-8px]">
                    <div className="space-y-1">
                      {projects.map((project) => {
                        const projectMigs = projectMigrations.filter(m => m.projectId === project.id);
                        const hasProjectMigrations = projectMigs.length > 0;
                        return (
                          <div key={project.id} className="space-y-1">
                            <div className="flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-sm transition-all duration-200 hover:translate-x-0.5">
                              <div className="flex flex-1 items-center gap-2">
                                {hasProjectMigrations && (
                                  <button
                                    type="button"
                                    onClick={() => toggleProject(project.id)}
                                    className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                                    aria-label={expandedProjects.has(project.id) ? "Projekt einklappen" : "Projekt ausklappen"}
                                    aria-expanded={expandedProjects.has(project.id)}
                                  >
                                    {expandedProjects.has(project.id) ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => navigate(`/projects/${project.id}`)}
                                  className="flex-1 text-left font-normal text-muted-foreground transition-colors hover:text-foreground"
                                >
                                  {project.name}
                                </button>
                              </div>
                              <button
                                onClick={() => onNewProjectMigration?.(project.id)}
                                className="rounded p-1 transition-colors hover:bg-foreground/5"
                                aria-label="Neue Migration"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>

                            {expandedProjects.has(project.id) && projectMigs.length > 0 && (
                              <div className="ml-6 space-y-1">
                                {projectMigs.map((migration) => (
                                  <div
                                    key={migration.id}
                                    className={cn(
                                      "group flex items-center justify-between w-full rounded-lg px-4 py-2 text-sm transition-all duration-200",
                                      selectedMigration === migration.id
                                        ? "bg-gradient-to-r from-primary/10 to-transparent border-l-2 border-primary text-foreground font-medium"
                                        : "text-muted-foreground/80 hover:bg-foreground/5 hover:text-foreground hover:translate-x-0.5",
                                    )}
                                  >
                                    <button
                                      onClick={() => navigate(`/projects/${project.id}/migration/${migration.id}`)}
                                      className="flex-1 text-left flex items-center gap-2"
                                    >
                                      {migration.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin" />}
                                      <span>{migration.name}</span>
                                    </button>
                                    <div className="opacity-0 transition-opacity group-hover:opacity-100">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => e.stopPropagation()}>
                                            <MoreHorizontal className="h-4 w-4" />
                                            <span className="sr-only">Migrationsmenü</span>
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                          <DropdownMenuItem onSelect={() => onDuplicateMigration?.(migration.id)}>
                                            <Copy className="mr-2 h-4 w-4" />
                                            <span>Duplizieren</span>
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onSelect={() => onDeleteMigration?.(migration.id)}
                                            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                          >
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            <span>Löschen</span>
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <div className="h-px w-full bg-gradient-to-r from-transparent via-border/60 to-transparent my-2 flex-shrink-0" />

              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-shrink-0 flex items-center justify-between px-2 py-2">
                  <h3 
                    className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => navigate("/migrations")}
                  >
                    <Layers className="h-3 w-3" />
                    Migrationen {totalMigrationsCount > 0 && `(${totalMigrationsCount})`}
                  </h3>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={onNewMigration}
                        size="sm"
                        className="h-7 rounded-full px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Neu
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>Neue Migration erstellen</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div 
                  ref={migrationsScrollRef}
                  className="flex-1 overflow-y-auto min-h-0 space-y-1 pr-1"
                >
                  {standaloneMigrations.length > 0 ? (
                    <>
                      {standaloneMigrations.map((migration) => (
                        <div
                          key={migration.id}
                          className={cn(
                            "group flex items-center justify-between w-full rounded-lg px-4 py-2 text-sm transition-all duration-200",
                            selectedMigration === migration.id
                              ? "bg-gradient-to-r from-primary/10 to-transparent border-l-2 border-primary text-foreground font-medium"
                              : "text-muted-foreground/80 hover:bg-foreground/5 hover:text-foreground hover:translate-x-0.5",
                          )}
                        >
                          <button
                            onClick={() => navigate(`/migration/${migration.id}`)}
                            className="flex-1 text-left flex items-center gap-2"
                          >
                            {migration.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin" />}
                            <span>{migration.name}</span>
                          </button>
                          <div className="opacity-0 transition-opacity group-hover:opacity-100">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => e.stopPropagation()}>
                                  <MoreHorizontal className="h-4 w-4" />
                                  <span className="sr-only">Migrationsmenü</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem onSelect={() => onDuplicateMigration?.(migration.id)}>
                                  <Copy className="mr-2 h-4 w-4" />
                                  <span>Duplizieren</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => onDeleteMigration?.(migration.id)}
                                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  <span>Löschen</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))}

                      {isLoadingMoreMigrations && (
                        <div className="flex items-center justify-center py-4 animate-fade-in">
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50">
                            <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            <span className="text-xs text-muted-foreground">
                              Lade weitere...
                            </span>
                          </div>
                        </div>
                      )}

                      {!hasMoreMigrations && standaloneMigrations.length > 0 && totalMigrationsCount > 20 && (
                        <p className="text-center text-xs text-muted-foreground/50 py-2">
                          Alle {totalMigrationsCount} Migrationen geladen
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="px-4 py-2 text-xs text-muted-foreground">Keine Migrationen</p>
                  )}
                </div>
              </div>
            </nav>

            <div className="h-px w-full bg-gradient-to-r from-transparent via-border/40 to-transparent mt-3 flex-shrink-0" />
            <div className="flex-shrink-0 pt-2 pb-1 text-center">
              <span className="text-[9px] font-medium text-muted-foreground/40 uppercase tracking-[0.2em]">
                Celion
              </span>
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  );
};

export default Sidebar;
