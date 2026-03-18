import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileText, CheckCircle2, AlertCircle, ListChecks, History, Map } from "lucide-react";
import { exportMigrationReportToPdf } from "@/lib/report-exporter";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface ReportDisplayProps {
  data: any;
}

const ReportDisplay = ({ data }: ReportDisplayProps) => {
  if (!data || data.type !== 'migration_report') return null;

  const { migrationInfo, summary, transferStats, mappings, activities } = data;

  const handleDownloadPdf = () => {
    exportMigrationReportToPdf(data);
  };

  const totalSuccess = transferStats.reduce((acc: number, s: any) => acc + parseInt(s.success_count), 0);
  const totalFailed = transferStats.reduce((acc: number, s: any) => acc + parseInt(s.failed_count), 0);
  const successRate = totalSuccess + totalFailed > 0 
    ? Math.round((totalSuccess / (totalSuccess + totalFailed)) * 100) 
    : 0;

  return (
    <div className="mt-4 space-y-6 w-full animate-in fade-in duration-700">
      {/* Header Card */}
      <Card className="border-primary/20 bg-primary/5 shadow-lg overflow-hidden">
        <div className="h-2 bg-gradient-to-r from-primary via-violet-500 to-emerald-500" />
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              Abschlussbericht
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Migration: {migrationInfo.name}
            </p>
          </div>
          <Button onClick={handleDownloadPdf} className="bg-primary hover:bg-primary/90 text-white flex items-center gap-2">
            <Download className="h-4 w-4" />
            PDF Herunterladen
          </Button>
        </CardHeader>
        <CardContent>
          <div className="bg-background/50 rounded-xl p-4 border border-primary/10">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Zusammenfassung
            </h4>
            <p className="text-sm leading-relaxed italic text-foreground/80">
              "{summary}"
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            <div className="p-4 rounded-xl border border-primary/10 bg-background/40">
              <p className="text-xs font-bold uppercase text-muted-foreground mb-1">Erfolgsquote</p>
              <div className="flex items-center gap-3">
                <span className="text-3xl font-black text-primary">{successRate}%</span>
                <Progress value={successRate} className="h-2 flex-1" />
              </div>
            </div>
            <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
              <p className="text-xs font-bold uppercase text-emerald-600 mb-1">Erfolgreich</p>
              <span className="text-3xl font-black text-emerald-700">{totalSuccess}</span>
              <p className="text-[10px] text-emerald-600 mt-1">Übertragene Objekte</p>
            </div>
            <div className={cn(
              "p-4 rounded-xl border bg-background/40",
              totalFailed > 0 ? "border-red-500/20 bg-red-500/5" : "border-primary/10"
            )}>
              <p className={cn("text-xs font-bold uppercase mb-1", totalFailed > 0 ? "text-red-600" : "text-muted-foreground")}>Fehlgeschlagen</p>
              <span className={cn("text-3xl font-black", totalFailed > 0 ? "text-red-700" : "text-muted-foreground")}>{totalFailed}</span>
              <p className="text-[10px] text-muted-foreground mt-1">Warnungen / Fehler</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Details Accordion */}
      <Accordion type="multiple" className="w-full space-y-4">
        <AccordionItem value="transfer" className="border border-primary/10 rounded-xl px-4 bg-background shadow-sm">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <ListChecks className="h-4 w-4 text-primary" />
              </div>
              <span className="font-semibold text-sm">Transfer Details nach Entität</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-3">
              {transferStats.map((stat: any) => (
                <div key={stat.entity_type} className="flex items-center justify-between p-3 rounded-lg border border-primary/5 bg-muted/30">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold capitalize">{stat.entity_type.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-muted-foreground">{parseInt(stat.success_count) + parseInt(stat.failed_count)} Gesamt</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-bold text-emerald-600">{stat.success_count} OK</span>
                      {parseInt(stat.failed_count) > 0 && <span className="text-xs font-bold text-red-600">{stat.failed_count} Fehlers</span>}
                    </div>
                    <Badge variant="outline" className={cn(
                      "min-w-[45px] justify-center",
                      parseInt(stat.failed_count) === 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
                    )}>
                      {Math.round((parseInt(stat.success_count) / (parseInt(stat.success_count) + parseInt(stat.failed_count))) * 100)}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="mapping" className="border border-primary/10 rounded-xl px-4 bg-background shadow-sm">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-violet-500/10 flex items-center justify-center">
                <Map className="h-4 w-4 text-violet-500" />
              </div>
              <span className="font-semibold text-sm">Mapping Logik ({mappings.length} Regeln)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-primary/10 text-muted-foreground font-medium uppercase tracking-wider">
                    <th className="py-2 px-2">Quelle</th>
                    <th className="py-2 px-2">Ziel</th>
                    <th className="py-2 px-2">Typ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-primary/5">
                  {mappings.map((m: any, idx: number) => (
                    <tr key={idx} className="hover:bg-primary/5 transition-colors">
                      <td className="py-2 px-2 font-mono text-primary/80">{m.source_object}.{m.source_property || '*'}</td>
                      <td className="py-2 px-2 font-mono text-violet-600">{m.target_object}.{m.target_property || '*'}</td>
                      <td className="py-2 px-2"><Badge variant="secondary" className="text-[9px] uppercase">{m.rule_type}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="activities" className="border border-primary/10 rounded-xl px-4 bg-background shadow-sm">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <History className="h-4 w-4 text-emerald-500" />
              </div>
              <span className="font-semibold text-sm">Aktivitätsprotokoll</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-4 pt-2">
              {activities.slice(-10).map((activity: any, idx: number) => (
                <div key={idx} className="flex gap-3 relative pb-4 last:pb-0">
                  {idx < activities.slice(-10).length - 1 && (
                    <div className="absolute left-1.5 top-4 bottom-0 w-px bg-primary/10" />
                  )}
                  <div className={cn(
                    "h-3 w-3 rounded-full mt-1.5 shrink-0 z-10",
                    activity.type === 'success' ? 'bg-emerald-500' :
                    activity.type === 'error' ? 'bg-red-500' :
                    activity.type === 'warning' ? 'bg-amber-500' : 'bg-primary'
                  )} />
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground font-medium uppercase">{activity.timestamp}</span>
                    <span className="text-sm font-medium">{activity.title}</span>
                  </div>
                </div>
              ))}
              {activities.length > 10 && (
                <p className="text-[10px] text-center text-muted-foreground italic">... siehe PDF für komplettes Protokoll</p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default ReportDisplay;

// Helper function for conditional classes
function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}
