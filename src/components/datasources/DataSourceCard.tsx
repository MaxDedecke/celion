import {
  Trash2,
  Pencil,
  Database,
  GitBranch,
  Github,
  Gitlab,
  Cloud,
  Box,
  ShieldCheck,
  Globe2,
  Power,
  Link2,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DataSourceWithProjects } from "@/types/dataSource";

interface DataSourceCardProps {
  source: DataSourceWithProjects;
  onEdit: (source: DataSourceWithProjects) => void;
  onDelete: (id: string) => void;
}

const getSourceIcon = (sourceType: string) => {
  const type = sourceType.toLowerCase();
  if (type.includes('jira')) return Database;
  if (type.includes('azure') || type.includes('devops')) return Cloud;
  if (type.includes('github')) return Github;
  if (type.includes('gitlab')) return Gitlab;
  if (type.includes('git')) return GitBranch;
  return Box;
};

export function DataSourceCard({ source, onEdit, onDelete }: DataSourceCardProps) {
  const SourceIcon = getSourceIcon(source.source_type);
  const availabilityText = source.is_global
    ? "Global"
    : source.assigned_projects && source.assigned_projects.length > 0
    ? `${source.assigned_projects.length} ${source.assigned_projects.length === 1 ? "Projekt" : "Projekte"}`
    : "Kein Zugriff";

  return (
    <Card
      onClick={() => onEdit(source)}
      className="group relative cursor-pointer overflow-hidden border-border/60 bg-gradient-to-br from-background/95 to-background/80 transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_24px_48px_-28px_rgba(15,23,42,0.45)]"
    >
      <CardHeader className="flex flex-row items-center gap-4 pb-3">
        <div className="flex-shrink-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/50 bg-foreground/5 text-foreground transition-all duration-300 group-hover:bg-primary/10 group-hover:text-primary">
            <SourceIcon className="h-6 w-6" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <CardTitle className="text-lg text-foreground group-hover:text-primary">{source.name}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{source.source_type}</p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onEdit(source); }}
            className="rounded-full hover:bg-foreground/5"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onDelete(source.id); }}
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
          {source.email && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span className="truncate">{source.email}</span>
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
}