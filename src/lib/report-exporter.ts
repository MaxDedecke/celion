import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export const exportMigrationReportToPdf = (reportData: any) => {
  const doc = new jsPDF();
  const { migrationInfo, summary, transferStats, mappings, activities } = reportData;

  // Header & Title
  doc.setFontSize(22);
  doc.setTextColor(110, 86, 207); // Celion Purple
  doc.text("Celion Migration Report", 14, 20);
  
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text(`Projekt: ${migrationInfo.name}`, 14, 30);
  doc.text(`Datum: ${new Date(reportData.generatedAt).toLocaleString('de-DE')}`, 14, 37);
  doc.text(`Systeme: ${migrationInfo.source_system} -> ${migrationInfo.target_system}`, 14, 44);

  // Executive Summary
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text("Zusammenfassung", 14, 60);
  
  doc.setFontSize(10);
  const splitSummary = doc.splitTextToSize(summary || "Keine Zusammenfassung verfügbar.", 180);
  doc.text(splitSummary, 14, 70);

  // Transfer Statistics Table
  doc.setFontSize(16);
  doc.text("Transfer Statistiken", 14, 100);
  
  const statsRows = transferStats.map((s: any) => [
    s.entity_type,
    s.success_count,
    s.failed_count,
    `${Math.round((parseInt(s.success_count) / (parseInt(s.success_count) + parseInt(s.failed_count))) * 100)}%`
  ]);

  autoTable(doc, {
    startY: 105,
    head: [['Entität', 'Erfolgreich', 'Fehlgeschlagen', 'Erfolgsquote']],
    body: statsRows,
    theme: 'striped',
    headStyles: { fillColor: [110, 86, 207] }
  });

  // Mapping Logic
  doc.addPage();
  doc.setFontSize(16);
  doc.text("Mapping Konfiguration", 14, 20);

  const mappingRows = mappings.map((m: any) => [
    `${m.source_object}.${m.source_property || '*'}`,
    `${m.target_object}.${m.target_property || '*'}`,
    m.rule_type
  ]);

  autoTable(doc, {
    startY: 25,
    head: [['Quelle', 'Ziel', 'Regel']],
    body: mappingRows,
    theme: 'grid',
    headStyles: { fillColor: [110, 86, 207] }
  });

  // Activity Log
  doc.addPage();
  doc.setFontSize(16);
  doc.text("Aktivitätsprotokoll", 14, 20);

  const activityRows = activities.map((a: any) => [
    a.timestamp,
    a.type.toUpperCase(),
    a.title
  ]);

  autoTable(doc, {
    startY: 25,
    head: [['Zeitstempel', 'Typ', 'Aktion']],
    body: activityRows,
    theme: 'plain',
    headStyles: { fillColor: [110, 86, 207] },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 30 }
    }
  });

  // Footer on all pages
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Seite ${i} von ${pageCount}`, 105, 285, { align: 'center' });
    doc.text("Generiert von Celion - Die KI-gestützte Migrationsplattform", 14, 285);
  }

  // Save PDF
  const fileName = `Celion_Report_${migrationInfo.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
};
