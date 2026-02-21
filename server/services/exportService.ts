import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import type { MassBalanceResults, TreatmentStage, ADProcessStage, EquipmentItem, CapexResults, CapexLineItem, CapexSummary, OpexResults, OpexLineItem, OpexSummary, VendorList, FinancialModelResults, FinancialMetrics, ProFormaYear, FinancialAssumptions } from "@shared/schema";

function sanitize(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u00A0/g, " ");
}

function fmtNum(val: number | undefined, decimals: number = 1): string {
  if (val === undefined || val === null) return "-";
  return val.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(val: number): string {
  if (val === undefined || val === null || isNaN(val)) return "$0";
  return "$" + val.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function drawTable(
  doc: InstanceType<typeof PDFDocument>,
  headers: string[],
  rows: string[][],
  startX: number,
  startY: number,
  colWidths: number[],
  options?: { fontSize?: number; headerBg?: string }
): number {
  const fontSize = options?.fontSize || 8;
  const headerBg = options?.headerBg || "#2563EB";
  const minRowHeight = 16;
  const cellPadding = 3;
  const pageHeight = 792;
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  let y = startY;

  const measureRowHeight = (cells: string[], bold: boolean): number => {
    let maxH = minRowHeight;
    for (let i = 0; i < cells.length; i++) {
      const cellWidth = colWidths[i] - cellPadding * 2;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
      const textH = doc.heightOfString(sanitize(cells[i] || ""), { width: cellWidth });
      const cellH = textH + cellPadding * 2;
      if (cellH > maxH) maxH = cellH;
    }
    return maxH;
  };

  const drawRow = (cells: string[], bold: boolean, bgColor?: string) => {
    const rowH = measureRowHeight(cells, bold);
    if (y + rowH > pageHeight - 60) {
      doc.addPage();
      y = 50;
      drawRow(headers, true, headerBg);
    }
    if (bgColor) {
      doc.rect(startX, y, tableWidth, rowH).fill(bgColor);
    }
    let x = startX;
    for (let i = 0; i < cells.length; i++) {
      const cellText = sanitize(cells[i] || "");
      doc.font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(fontSize)
        .fillColor(bgColor === headerBg ? "#FFFFFF" : "#333333")
        .text(cellText, x + cellPadding, y + cellPadding, {
          width: colWidths[i] - cellPadding * 2,
          lineBreak: true,
        });
      x += colWidths[i];
    }
    doc.rect(startX, y, tableWidth, rowH).lineWidth(0.5).strokeColor("#CCCCCC").stroke();
    y += rowH;
  };

  drawRow(headers, true, headerBg);
  rows.forEach((row, idx) => {
    const safeRow = row.map(cell => cell ?? "-");
    drawRow(safeRow, false, idx % 2 === 1 ? "#F8F9FA" : undefined);
  });
  return y;
}

function addSectionHeader(doc: InstanceType<typeof PDFDocument>, title: string, y: number, leftMargin: number, contentWidth: number): number {
  if (y > 700) {
    doc.addPage();
    y = 50;
  }
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#1E3A5F")
    .text(title, leftMargin, y, { width: contentWidth });
  y += 20;
  doc.moveTo(leftMargin, y).lineTo(leftMargin + contentWidth, y).lineWidth(0.5).strokeColor("#CCCCCC").stroke();
  y += 8;
  return y;
}

export function exportMassBalancePDF(
  results: MassBalanceResults,
  scenarioName: string,
  projectName: string,
  projectType: string
): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "letter", margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const leftMargin = 50;
    const contentWidth = 512;
    const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#1E3A5F")
      .text("Mass Balance Report", leftMargin, 50, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#666666")
      .text(`Project: ${sanitize(projectName)}`, leftMargin, 75, { align: "center", width: contentWidth })
      .text(`Scenario: ${sanitize(scenarioName)}`, leftMargin, 88, { align: "center", width: contentWidth })
      .text(`Type ${projectType}: ${typeLabels[projectType] || projectType}`, leftMargin, 101, { align: "center", width: contentWidth })
      .text(`Generated: ${new Date().toLocaleDateString("en-US")}`, leftMargin, 114, { align: "center", width: contentWidth });

    let y = 140;

    if (results.assumptions && results.assumptions.length > 0) {
      y = addSectionHeader(doc, "Design Assumptions", y, leftMargin, contentWidth);
      const assHeaders = ["Parameter", "Value", "Source"];
      const assRows = results.assumptions.map(a => [sanitize(a.parameter), sanitize(a.value), sanitize(a.source)]);
      const assWidths = [180, 162, 170];
      y = drawTable(doc, assHeaders, assRows, leftMargin, y, assWidths);
      y += 15;
    }

    if (results.summary && Object.keys(results.summary).length > 0) {
      y = addSectionHeader(doc, "Summary", y, leftMargin, contentWidth);
      const summaryHeaders = ["Parameter", "Value", "Unit"];
      const summaryRows = Object.entries(results.summary).map(([key, val]) => [
        key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim(),
        val?.value ?? "-",
        val?.unit ?? "",
      ]);
      const summaryWidths = [200, 162, 150];
      y = drawTable(doc, summaryHeaders, summaryRows, leftMargin, y, summaryWidths);
      y += 15;
    }

    if (results.adStages && results.adStages.length > 0) {
      y = addSectionHeader(doc, "Process Stages", y, leftMargin, contentWidth);
      for (const stage of results.adStages) {
        if (y > 680) { doc.addPage(); y = 50; }
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#333333")
          .text(`${sanitize(stage.name)} (${sanitize(stage.type)})`, leftMargin, y);
        y += 14;
        const allKeys = new Set([
          ...Object.keys(stage.inputStream || {}),
          ...Object.keys(stage.outputStream || {}),
        ]);
        const adHeaders = ["Parameter", "Input", "Output"];
        const adRows = Array.from(allKeys).map(key => {
          const inp = stage.inputStream?.[key];
          const out = stage.outputStream?.[key];
          return [
            key.replace(/([A-Z])/g, " $1").trim(),
            inp ? `${fmtNum(inp.value)} ${inp.unit}` : "-",
            out ? `${fmtNum(out.value)} ${out.unit}` : "-",
          ];
        });
        const adWidths = [171, 171, 170];
        y = drawTable(doc, adHeaders, adRows, leftMargin, y, adWidths);
        y += 10;
      }
    }

    if (results.equipment && results.equipment.length > 0) {
      y = addSectionHeader(doc, "Equipment List", y, leftMargin, contentWidth);
      const eqHeaders = ["Process", "Equipment", "Qty", "Description", "Design Basis"];
      const eqRows = results.equipment.map(eq => [
        sanitize(eq.process),
        sanitize(eq.equipmentType),
        String(eq.quantity),
        sanitize(eq.description),
        sanitize(eq.designBasis),
      ]);
      const eqWidths = [90, 100, 32, 160, 130];
      y = drawTable(doc, eqHeaders, eqRows, leftMargin, y, eqWidths);
      y += 15;
    }

    if (results.stages && results.stages.length > 0) {
      y = addSectionHeader(doc, "Treatment Train - Stream Data", y, leftMargin, contentWidth);
      if (results.convergenceAchieved !== undefined) {
        doc.font("Helvetica").fontSize(8).fillColor("#666666")
          .text(`Convergence: ${results.convergenceAchieved ? "Yes" : "No"} (${results.convergenceIterations} iterations)`, leftMargin, y);
        y += 14;
      }
      for (const stage of results.stages) {
        if (y > 680) { doc.addPage(); y = 50; }
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#333333")
          .text(`${sanitize(stage.name)} (${sanitize(stage.type)})`, leftMargin, y);
        y += 14;
        const streamHeaders = ["Parameter", "Influent", "Effluent", "Removal %"];
        const params = ["flow", "bod", "cod", "tss", "tkn", "tp", "fog"] as const;
        const paramLabels: Record<string, string> = { flow: "Flow (GPD)", bod: "BOD (mg/L)", cod: "COD (mg/L)", tss: "TSS (mg/L)", tkn: "TKN (mg/L)", tp: "TP (mg/L)", fog: "FOG (mg/L)" };
        const streamRows = params.map(p => [
          paramLabels[p] || p.toUpperCase(),
          fmtNum(stage.influent[p]),
          fmtNum(stage.effluent[p]),
          stage.removalEfficiencies[p] !== undefined ? `${fmtNum(stage.removalEfficiencies[p])}%` : "-",
        ]);
        const streamWidths = [128, 128, 128, 128];
        y = drawTable(doc, streamHeaders, streamRows, leftMargin, y, streamWidths);
        y += 10;
      }
    }

    doc.end();
  });
}

export function exportMassBalanceExcel(
  results: MassBalanceResults,
  scenarioName: string,
  projectName: string,
  projectType: string
): Buffer {
  const wb = XLSX.utils.book_new();
  const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };

  if (results.assumptions && results.assumptions.length > 0) {
    const assData: string[][] = [
      ["Design Assumptions"],
      [],
      ["Parameter", "Value", "Source"],
      ...results.assumptions.map(a => [a.parameter, a.value, a.source]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(assData);
    ws["!cols"] = [{ wch: 30 }, { wch: 25 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, "Assumptions");
  }

  if (results.summary && Object.keys(results.summary).length > 0) {
    const summaryData = [
      ["Mass Balance Summary"],
      [`Project: ${projectName}`, `Scenario: ${scenarioName}`, `Type: ${projectType} - ${typeLabels[projectType] || ""}`],
      [],
      ["Parameter", "Value", "Unit"],
      ...Object.entries(results.summary).map(([key, val]) => [
        key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim(),
        val?.value ?? "-",
        val?.unit ?? "",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(summaryData);
    ws["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
  }

  if (results.adStages && results.adStages.length > 0) {
    const adData: (string | number)[][] = [["Process Stages"], []];
    for (const stage of results.adStages) {
      adData.push([`${stage.name} (${stage.type})`]);
      adData.push(["Parameter", "Input Value", "Input Unit", "Output Value", "Output Unit"]);
      const allKeys = new Set([
        ...Object.keys(stage.inputStream || {}),
        ...Object.keys(stage.outputStream || {}),
      ]);
      for (const key of allKeys) {
        const inp = stage.inputStream?.[key];
        const out = stage.outputStream?.[key];
        adData.push([
          key.replace(/([A-Z])/g, " $1").trim(),
          inp?.value ?? "",
          inp?.unit ?? "",
          out?.value ?? "",
          out?.unit ?? "",
        ]);
      }
      adData.push([]);
    }
    const ws = XLSX.utils.aoa_to_sheet(adData);
    ws["!cols"] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, "Process");
  }

  if (results.equipment && results.equipment.length > 0) {
    const eqData: (string | number)[][] = [
      ["Equipment List"],
      [],
      ["Process", "Equipment Type", "Qty", "Description", "Design Basis", "Notes"],
      ...results.equipment.map(eq => [
        eq.process,
        eq.equipmentType,
        eq.quantity,
        eq.description,
        eq.designBasis,
        eq.notes,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(eqData);
    ws["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 6 }, { wch: 35 }, { wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, "Equipment");
  }

  if (results.stages && results.stages.length > 0) {
    const stageData: (string | number)[][] = [
      ["Treatment Train - Stream Data"],
      [`Convergence: ${results.convergenceAchieved ? "Yes" : "No"} (${results.convergenceIterations} iterations)`],
      [],
    ];
    for (const stage of results.stages) {
      stageData.push([`${stage.name} (${stage.type})`]);
      stageData.push(["Parameter", "Influent", "Effluent", "Removal %"]);
      const params = ["flow", "bod", "cod", "tss", "tkn", "tp", "fog"] as const;
      const paramLabels: Record<string, string> = { flow: "Flow (GPD)", bod: "BOD (mg/L)", cod: "COD (mg/L)", tss: "TSS (mg/L)", tkn: "TKN (mg/L)", tp: "TP (mg/L)", fog: "FOG (mg/L)" };
      for (const p of params) {
        stageData.push([
          paramLabels[p] || p.toUpperCase(),
          stage.influent[p] ?? "",
          stage.effluent[p] ?? "",
          stage.removalEfficiencies[p] !== undefined ? stage.removalEfficiencies[p] : "",
        ]);
      }
      stageData.push([]);
    }
    const ws = XLSX.utils.aoa_to_sheet(stageData);
    ws["!cols"] = [{ wch: 25 }, { wch: 18 }, { wch: 18 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, "Treatment Train");
  }

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export function exportCapexPDF(
  results: CapexResults,
  scenarioName: string,
  projectName: string,
  projectType: string
): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "letter", margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const leftMargin = 50;
    const contentWidth = 512;
    const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#1E3A5F")
      .text("Capital Cost Estimate", leftMargin, 50, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#666666")
      .text(`Project: ${sanitize(projectName)}`, leftMargin, 75, { align: "center", width: contentWidth })
      .text(`Scenario: ${sanitize(scenarioName)}`, leftMargin, 88, { align: "center", width: contentWidth })
      .text(`Type ${projectType}: ${typeLabels[projectType] || projectType}`, leftMargin, 101, { align: "center", width: contentWidth })
      .text(`Cost Year: ${results.costYear || "Current"} | Currency: ${results.currency || "USD"}`, leftMargin, 114, { align: "center", width: contentWidth })
      .text(`Generated: ${new Date().toLocaleDateString("en-US")}`, leftMargin, 127, { align: "center", width: contentWidth });

    let y = 155;

    const summary = results.summary;
    if (summary) {
      y = addSectionHeader(doc, "Cost Summary", y, leftMargin, contentWidth);
      const sumRows: string[][] = [
        ["Total Equipment Cost", fmtCurrency(summary.totalEquipmentCost)],
        ["Total Installed Cost", fmtCurrency(summary.totalInstalledCost)],
        ["Total Contingency", fmtCurrency(summary.totalContingency)],
        ["Total Direct Cost", fmtCurrency(summary.totalDirectCost)],
        [`Engineering (${summary.engineeringPct}%)`, fmtCurrency(summary.engineeringCost)],
        ["Total Project Cost", fmtCurrency(summary.totalProjectCost)],
      ];
      if (summary.costPerUnit) {
        sumRows.push([`Cost per Unit (${summary.costPerUnit.basis})`, `${fmtCurrency(summary.costPerUnit.value)} / ${summary.costPerUnit.unit}`]);
      }
      y = drawTable(doc, ["Item", "Amount"], sumRows, leftMargin, y, [300, 212], { headerBg: "#1E3A5F" });
      y += 15;
    }

    if (results.lineItems && results.lineItems.length > 0) {
      y = addSectionHeader(doc, "Line Items", y, leftMargin, contentWidth);
      const liHeaders = ["Process", "Equipment", "Qty", "Base Cost", "Install Factor", "Installed", "Contingency", "Total"];
      const liRows = results.lineItems.map(li => [
        sanitize(li.process),
        sanitize(li.equipmentType),
        String(li.quantity),
        fmtCurrency(li.baseCostPerUnit),
        `${fmtNum(li.installationFactor, 2)}x`,
        fmtCurrency(li.installedCost),
        fmtCurrency(li.contingencyCost),
        fmtCurrency(li.totalCost),
      ]);
      const liWidths = [80, 80, 28, 64, 52, 72, 64, 72];
      y = drawTable(doc, liHeaders, liRows, leftMargin, y, liWidths, { fontSize: 7 });
      y += 15;
    }

    if (results.assumptions && results.assumptions.length > 0) {
      y = addSectionHeader(doc, "Assumptions", y, leftMargin, contentWidth);
      const assHeaders = ["Parameter", "Value", "Source"];
      const assRows = results.assumptions.map(a => [sanitize(a.parameter), sanitize(a.value), sanitize(a.source)]);
      y = drawTable(doc, assHeaders, assRows, leftMargin, y, [180, 162, 170]);
    }

    if (results.methodology) {
      if (y > 700) { doc.addPage(); y = 50; }
      y = addSectionHeader(doc, "Methodology", y, leftMargin, contentWidth);
      doc.font("Helvetica").fontSize(9).fillColor("#333333")
        .text(sanitize(results.methodology), leftMargin, y, { width: contentWidth, lineGap: 2 });
    }

    doc.end();
  });
}

export function exportCapexExcel(
  results: CapexResults,
  scenarioName: string,
  projectName: string,
  projectType: string
): Buffer {
  const wb = XLSX.utils.book_new();
  const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };

  const summary = results.summary;
  if (summary) {
    const sumData: (string | number)[][] = [
      ["Capital Cost Estimate - Summary"],
      [`Project: ${projectName}`, `Scenario: ${scenarioName}`, `Type: ${projectType} - ${typeLabels[projectType] || ""}`],
      [`Cost Year: ${results.costYear || "Current"}`, `Currency: ${results.currency || "USD"}`],
      [],
      ["Item", "Amount ($)"],
      ["Total Equipment Cost", summary.totalEquipmentCost],
      ["Total Installed Cost", summary.totalInstalledCost],
      ["Total Contingency", summary.totalContingency],
      ["Total Direct Cost", summary.totalDirectCost],
      [`Engineering (${summary.engineeringPct}%)`, summary.engineeringCost],
      ["Total Project Cost", summary.totalProjectCost],
    ];
    if (summary.costPerUnit) {
      sumData.push([`Cost per Unit (${summary.costPerUnit.basis} - ${summary.costPerUnit.unit})`, summary.costPerUnit.value]);
    }
    const ws = XLSX.utils.aoa_to_sheet(sumData);
    ws["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
  }

  if (results.lineItems && results.lineItems.length > 0) {
    const liData: (string | number)[][] = [
      ["Line Items"],
      [],
      ["Process", "Equipment Type", "Description", "Qty", "Base Cost/Unit ($)", "Installation Factor", "Installed Cost ($)", "Contingency %", "Contingency ($)", "Total Cost ($)", "Cost Basis", "Source", "Notes"],
      ...results.lineItems.map(li => [
        li.process,
        li.equipmentType,
        li.description,
        li.quantity,
        li.baseCostPerUnit,
        li.installationFactor,
        li.installedCost,
        li.contingencyPct,
        li.contingencyCost,
        li.totalCost,
        li.costBasis,
        li.source,
        li.notes,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(liData);
    ws["!cols"] = [
      { wch: 18 }, { wch: 20 }, { wch: 30 }, { wch: 6 },
      { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 10 },
      { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 25 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Line Items");
  }

  if (results.assumptions && results.assumptions.length > 0) {
    const assData: string[][] = [
      ["Assumptions"],
      [],
      ["Parameter", "Value", "Source"],
      ...results.assumptions.map(a => [a.parameter, a.value, a.source]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(assData);
    ws["!cols"] = [{ wch: 30 }, { wch: 25 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, "Assumptions");
  }

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export function exportOpexPDF(
  results: OpexResults,
  scenarioName: string,
  projectName: string,
  projectType: string
): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "letter", margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const leftMargin = 50;
    const contentWidth = 512;
    const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#1E3A5F")
      .text("Annual Operating Cost Estimate", leftMargin, 50, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#666666")
      .text(`Project: ${sanitize(projectName)}`, leftMargin, 75, { align: "center", width: contentWidth })
      .text(`Scenario: ${sanitize(scenarioName)}`, leftMargin, 88, { align: "center", width: contentWidth })
      .text(`Type ${projectType}: ${typeLabels[projectType] || projectType}`, leftMargin, 101, { align: "center", width: contentWidth })
      .text(`Cost Year: ${results.costYear || "Current"} | Currency: ${results.currency || "USD"}`, leftMargin, 114, { align: "center", width: contentWidth })
      .text(`Generated: ${new Date().toLocaleDateString("en-US")}`, leftMargin, 127, { align: "center", width: contentWidth });

    let y = 155;

    const summary = results.summary;
    if (summary) {
      y = addSectionHeader(doc, "Cost Summary", y, leftMargin, contentWidth);
      const sumRows: string[][] = [
        ["Total Annual OpEx", fmtCurrency(summary.totalAnnualOpex)],
        ["Labor", fmtCurrency(summary.totalLaborCost)],
        ["Energy", fmtCurrency(summary.totalEnergyCost)],
        ["Chemicals", fmtCurrency(summary.totalChemicalCost)],
        ["Maintenance", fmtCurrency(summary.totalMaintenanceCost)],
        ["Disposal", fmtCurrency(summary.totalDisposalCost)],
        ["Other", fmtCurrency(summary.totalOtherCost)],
        ["Revenue Offsets", fmtCurrency(summary.revenueOffsets)],
        ["Net Annual OpEx", fmtCurrency(summary.netAnnualOpex)],
      ];
      if (summary.opexAsPercentOfCapex !== undefined) {
        sumRows.push(["OpEx as % of CapEx", `${fmtNum(summary.opexAsPercentOfCapex)}%`]);
      }
      if (summary.opexPerUnit) {
        sumRows.push([`OpEx per Unit (${summary.opexPerUnit.basis})`, `${fmtCurrency(summary.opexPerUnit.value)} / ${summary.opexPerUnit.unit}`]);
      }
      y = drawTable(doc, ["Item", "Amount"], sumRows, leftMargin, y, [300, 212], { headerBg: "#1E3A5F" });
      y += 15;
    }

    if (results.lineItems && results.lineItems.length > 0) {
      y = addSectionHeader(doc, "Line Items", y, leftMargin, contentWidth);
      const liHeaders = ["Category", "Description", "Annual Cost ($)", "Unit Cost", "Unit Basis", "Scaling Basis", "Source"];
      const liRows = results.lineItems.map(li => [
        sanitize(li.category),
        sanitize(li.description),
        fmtCurrency(li.annualCost),
        li.unitCost !== undefined ? fmtCurrency(li.unitCost) : "-",
        sanitize(li.unitBasis || "-"),
        sanitize(li.scalingBasis || "-"),
        sanitize(li.source),
      ]);
      const liWidths = [72, 100, 72, 64, 64, 68, 72];
      y = drawTable(doc, liHeaders, liRows, leftMargin, y, liWidths, { fontSize: 7 });
      y += 15;
    }

    if (results.assumptions && results.assumptions.length > 0) {
      y = addSectionHeader(doc, "Assumptions", y, leftMargin, contentWidth);
      const assHeaders = ["Parameter", "Value", "Source"];
      const assRows = results.assumptions.map(a => [sanitize(a.parameter), sanitize(a.value), sanitize(a.source)]);
      y = drawTable(doc, assHeaders, assRows, leftMargin, y, [180, 162, 170]);
    }

    if (results.methodology) {
      if (y > 700) { doc.addPage(); y = 50; }
      y = addSectionHeader(doc, "Methodology", y, leftMargin, contentWidth);
      doc.font("Helvetica").fontSize(9).fillColor("#333333")
        .text(sanitize(results.methodology), leftMargin, y, { width: contentWidth, lineGap: 2 });
    }

    doc.end();
  });
}

export function exportOpexExcel(
  results: OpexResults,
  scenarioName: string,
  projectName: string,
  projectType: string
): Buffer {
  const wb = XLSX.utils.book_new();
  const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };

  const summary = results.summary;
  if (summary) {
    const sumData: (string | number)[][] = [
      ["Annual Operating Cost Estimate - Summary"],
      [`Project: ${projectName}`, `Scenario: ${scenarioName}`, `Type: ${projectType} - ${typeLabels[projectType] || ""}`],
      [`Cost Year: ${results.costYear || "Current"}`, `Currency: ${results.currency || "USD"}`],
      [],
      ["Item", "Amount ($)"],
      ["Total Annual OpEx", summary.totalAnnualOpex],
      ["Labor", summary.totalLaborCost],
      ["Energy", summary.totalEnergyCost],
      ["Chemicals", summary.totalChemicalCost],
      ["Maintenance", summary.totalMaintenanceCost],
      ["Disposal", summary.totalDisposalCost],
      ["Other", summary.totalOtherCost],
      ["Revenue Offsets", summary.revenueOffsets],
      ["Net Annual OpEx", summary.netAnnualOpex],
    ];
    if (summary.opexAsPercentOfCapex !== undefined) {
      sumData.push(["OpEx as % of CapEx", summary.opexAsPercentOfCapex]);
    }
    if (summary.opexPerUnit) {
      sumData.push([`OpEx per Unit (${summary.opexPerUnit.basis} - ${summary.opexPerUnit.unit})`, summary.opexPerUnit.value]);
    }
    const ws = XLSX.utils.aoa_to_sheet(sumData);
    ws["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
  }

  if (results.lineItems && results.lineItems.length > 0) {
    const liData: (string | number)[][] = [
      ["Line Items"],
      [],
      ["Category", "Description", "Annual Cost ($)", "Unit Cost ($)", "Unit Basis", "Scaling Basis", "Cost Basis", "Source", "Notes"],
      ...results.lineItems.map(li => [
        li.category,
        li.description,
        li.annualCost,
        li.unitCost ?? "",
        li.unitBasis ?? "",
        li.scalingBasis ?? "",
        li.costBasis,
        li.source,
        li.notes,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(liData);
    ws["!cols"] = [
      { wch: 18 }, { wch: 30 }, { wch: 15 }, { wch: 15 },
      { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 25 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Line Items");
  }

  if (results.assumptions && results.assumptions.length > 0) {
    const assData: string[][] = [
      ["Assumptions"],
      [],
      ["Parameter", "Value", "Source"],
      ...results.assumptions.map(a => [a.parameter, a.value, a.source]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(assData);
    ws["!cols"] = [{ wch: 30 }, { wch: 25 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, "Assumptions");
  }

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export function exportVendorListPDF(
  vendorList: VendorList,
  scenarioName: string,
  projectName: string,
  projectType: string
): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "letter", margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const leftMargin = 50;
    const contentWidth = 512;
    const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#1E3A5F")
      .text("Recommended Vendor List", leftMargin, 50, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#666666")
      .text(`Project: ${sanitize(projectName)}`, leftMargin, 75, { align: "center", width: contentWidth })
      .text(`Scenario: ${sanitize(scenarioName)}`, leftMargin, 88, { align: "center", width: contentWidth })
      .text(`Type ${projectType}: ${typeLabels[projectType] || projectType}`, leftMargin, 101, { align: "center", width: contentWidth })
      .text(`Generated: ${vendorList.generatedAt ? new Date(vendorList.generatedAt).toLocaleDateString("en-US") : new Date().toLocaleDateString("en-US")}`, leftMargin, 114, { align: "center", width: contentWidth })
      .text(`Model: ${sanitize(vendorList.modelUsed || "")}`, leftMargin, 127, { align: "center", width: contentWidth });

    let y = 155;

    for (const item of vendorList.items) {
      if (y > 650) { doc.addPage(); y = 50; }

      doc.rect(leftMargin, y, contentWidth, 22).fill("#2563EB");
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF")
        .text(`${sanitize(item.equipmentType)} — ${sanitize(item.process)}`, leftMargin + 8, y + 5, { width: contentWidth - 16 });
      y += 26;

      doc.font("Helvetica").fontSize(8).fillColor("#333333")
        .text(`Quantity: ${item.quantity}`, leftMargin + 8, y);
      y += 12;
      if (item.specsSummary) {
        doc.font("Helvetica").fontSize(8).fillColor("#555555")
          .text(`Specs: ${sanitize(item.specsSummary)}`, leftMargin + 8, y, { width: contentWidth - 16 });
        y += doc.heightOfString(`Specs: ${sanitize(item.specsSummary)}`, { width: contentWidth - 16 }) + 4;
      }

      if (item.recommendations && item.recommendations.length > 0) {
        y += 4;
        const recHeaders = ["#", "Manufacturer", "Model Number", "Website", "Notes"];
        const recWidths = [20, 110, 120, 130, 132];
        const recRows: string[][] = item.recommendations.map((rec, idx) => [
          String(idx + 1),
          sanitize(rec.manufacturer),
          sanitize(rec.modelNumber),
          sanitize(rec.websiteUrl || rec.specSheetUrl || ""),
          sanitize(rec.notes || ""),
        ]);
        y = drawTable(doc, recHeaders, recRows, leftMargin, y, recWidths, { fontSize: 7 });
      }

      y += 12;
    }

    doc.end();
  });
}

export function exportProjectSummaryPDF(
  mode: "executive" | "full",
  projectName: string,
  scenarioName: string,
  projectType: string,
  upifData: any,
  mbResults: MassBalanceResults,
  capexResults: CapexResults,
  opexResults: OpexResults,
  financialResults: FinancialModelResults,
): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "letter", margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const leftMargin = 50;
    const contentWidth = 512;
    const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };
    let pageNum = 1;

    let addingFooter = false;
    const addPageFooter = () => {
      if (addingFooter) return;
      addingFooter = true;
      doc.font("Helvetica").fontSize(7).fillColor("#999999")
        .text("Confidential", leftMargin, 750, { width: contentWidth, align: "center", lineBreak: false });
      doc.font("Helvetica").fontSize(7).fillColor("#999999")
        .text(`Page ${pageNum}`, leftMargin, 760, { width: contentWidth, align: "center", lineBreak: false });
      pageNum++;
      addingFooter = false;
    };

    doc.on("pageAdded", () => {
      addPageFooter();
    });

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#1E3A5F")
      .text("Project Summary", leftMargin, 50, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#666666")
      .text(`Project: ${sanitize(projectName)}`, leftMargin, 80, { align: "center", width: contentWidth })
      .text(`Scenario: ${sanitize(scenarioName)}`, leftMargin, 95, { align: "center", width: contentWidth })
      .text(`Type ${projectType}: ${typeLabels[projectType] || projectType}`, leftMargin, 110, { align: "center", width: contentWidth })
      .text(`Generated: ${new Date().toLocaleDateString("en-US")}`, leftMargin, 125, { align: "center", width: contentWidth });

    let y = 150;

    y = addSectionHeader(doc, "Project Overview", y, leftMargin, contentWidth);
    const description = upifData?.projectDescription || upifData?.description || "";
    if (description) {
      doc.font("Helvetica").fontSize(9).fillColor("#333333")
        .text(sanitize(description), leftMargin, y, { width: contentWidth, lineGap: 2 });
      y += doc.heightOfString(sanitize(description), { width: contentWidth }) + 8;
    }
    const location = upifData?.location || "";
    if (location) {
      doc.font("Helvetica").fontSize(9).fillColor("#333333")
        .text(`Location: ${sanitize(location)}`, leftMargin, y, { width: contentWidth });
      y += 14;
    }

    if (upifData?.feedstocks && Array.isArray(upifData.feedstocks) && upifData.feedstocks.length > 0) {
      y += 4;
      const fsHeaders = ["Feedstock Type", "Volume", "Unit"];
      const fsRows = upifData.feedstocks.map((fs: any) => [
        sanitize(fs.feedstockType || ""),
        sanitize(fs.feedstockVolume || "-"),
        sanitize(fs.feedstockUnit || ""),
      ]);
      y = drawTable(doc, fsHeaders, fsRows, leftMargin, y, [220, 146, 146]);
      y += 15;
    } else {
      y += 10;
    }

    const metrics = financialResults.metrics || {} as any;
    y = addSectionHeader(doc, "Financial Returns (Key Metrics)", y, leftMargin, contentWidth);
    const metricsHeaders = ["Metric", "Value", "Metric", "Value"];
    const metricsRows = [
      [
        "IRR",
        metrics.irr !== null && metrics.irr !== undefined ? `${fmtNum(metrics.irr * 100)}%` : "N/A",
        "Total CapEx",
        fmtCurrency(metrics.totalCapex),
      ],
      [
        "NPV @ 10%",
        fmtCurrency(metrics.npv10),
        "ITC Proceeds",
        fmtCurrency(metrics.itcProceeds),
      ],
      [
        "MOIC",
        `${fmtNum(metrics.moic, 1)}x`,
        "Total 10-Year Revenue",
        fmtCurrency(metrics.totalRevenue),
      ],
      [
        "Payback Period",
        metrics.paybackYears !== null && metrics.paybackYears !== undefined ? `${fmtNum(metrics.paybackYears, 1)} years` : "N/A",
        "Avg Annual EBITDA",
        fmtCurrency(metrics.averageAnnualEbitda),
      ],
    ];
    y = drawTable(doc, metricsHeaders, metricsRows, leftMargin, y, [100, 156, 120, 136], { headerBg: "#5B9BD5" });
    y += 15;

    addPageFooter();
    doc.addPage();
    y = 50;

    y = addSectionHeader(doc, "Equipment Summary", y, leftMargin, contentWidth);
    if (mbResults.equipment && mbResults.equipment.length > 0) {
      const maxEquipItems = 15;
      const truncated = mbResults.equipment.length > maxEquipItems;
      const displayItems = truncated ? mbResults.equipment.slice(0, maxEquipItems) : mbResults.equipment;
      const eqHeaders = ["Process", "Equipment", "Qty", "Key Specs"];
      const eqRows = displayItems.map(eq => {
        const specStr = eq.specs ? Object.entries(eq.specs).slice(0, 2).map(([k, v]) => `${k}: ${v.value} ${v.unit}`).join(", ") : eq.designBasis || "";
        return [
          sanitize(eq.process),
          sanitize(eq.equipmentType),
          String(eq.quantity),
          sanitize(specStr),
        ];
      });
      y = drawTable(doc, eqHeaders, eqRows, leftMargin, y, [100, 130, 32, 250]);
      if (truncated) {
        y += 4;
        doc.font("Helvetica-Oblique").fontSize(8).fillColor("#666666")
          .text("See Appendix for full list", leftMargin, y, { width: contentWidth });
        y += 14;
      }
      y += 10;
    }

    if (y > 680) { doc.addPage(); y = 50; }
    y = addSectionHeader(doc, "CapEx Summary", y, leftMargin, contentWidth);
    const capSummary = capexResults.summary;
    const capexSumRows: string[][] = [
      ["Equipment Cost", fmtCurrency(capSummary.totalEquipmentCost)],
      ["Installation Cost", fmtCurrency(capSummary.totalInstalledCost)],
      ["Contingency", fmtCurrency(capSummary.totalContingency)],
      ["Total Direct Cost", fmtCurrency(capSummary.totalDirectCost)],
      [`Engineering (${capSummary.engineeringPct}%)`, fmtCurrency(capSummary.engineeringCost)],
      ["Total Project Cost", fmtCurrency(capSummary.totalProjectCost)],
    ];
    y = drawTable(doc, ["Item", "Amount"], capexSumRows, leftMargin, y, [300, 212], { headerBg: "#1E3A5F" });
    y += 15;

    if (y > 680) { doc.addPage(); y = 50; }
    y = addSectionHeader(doc, "OpEx Summary", y, leftMargin, contentWidth);
    const opSummary = opexResults.summary;
    const opexSumRows: string[][] = [
      ["Total Annual OpEx", fmtCurrency(opSummary.totalAnnualOpex)],
      ["Labor", fmtCurrency(opSummary.totalLaborCost)],
      ["Energy", fmtCurrency(opSummary.totalEnergyCost)],
      ["Chemicals", fmtCurrency(opSummary.totalChemicalCost)],
      ["Maintenance", fmtCurrency(opSummary.totalMaintenanceCost)],
      ["Disposal", fmtCurrency(opSummary.totalDisposalCost)],
      ["Other", fmtCurrency(opSummary.totalOtherCost)],
      ["Net Annual OpEx", fmtCurrency(opSummary.netAnnualOpex)],
    ];
    y = drawTable(doc, ["Item", "Amount"], opexSumRows, leftMargin, y, [300, 212], { headerBg: "#1E3A5F" });
    y += 15;

    if (mode === "full") {
      doc.addPage();
      y = 50;
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#1E3A5F")
        .text("Appendix A - Mass Balance Details", leftMargin, y, { width: contentWidth });
      y += 25;

      if (mbResults.summary && Object.keys(mbResults.summary).length > 0) {
        y = addSectionHeader(doc, "Mass Balance Summary", y, leftMargin, contentWidth);
        const mbSumHeaders = ["Parameter", "Value", "Unit"];
        const mbSumRows = Object.entries(mbResults.summary).map(([key, val]) => [
          key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim(),
          val?.value ?? "-",
          val?.unit ?? "",
        ]);
        y = drawTable(doc, mbSumHeaders, mbSumRows, leftMargin, y, [200, 162, 150]);
        y += 15;
      }

      if (mbResults.equipment && mbResults.equipment.length > 0) {
        if (y > 680) { doc.addPage(); y = 50; }
        y = addSectionHeader(doc, "Full Equipment List", y, leftMargin, contentWidth);
        const fullEqHeaders = ["Process", "Equipment", "Qty", "Description", "Design Basis"];
        const fullEqRows = mbResults.equipment.map(eq => [
          sanitize(eq.process),
          sanitize(eq.equipmentType),
          String(eq.quantity),
          sanitize(eq.description),
          sanitize(eq.designBasis),
        ]);
        y = drawTable(doc, fullEqHeaders, fullEqRows, leftMargin, y, [90, 100, 32, 160, 130]);
        y += 15;
      }

      if (mbResults.adStages && mbResults.adStages.length > 0) {
        if (y > 680) { doc.addPage(); y = 50; }
        y = addSectionHeader(doc, "Process Stages Detail", y, leftMargin, contentWidth);
        for (const stage of mbResults.adStages) {
          if (y > 680) { doc.addPage(); y = 50; }
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#333333")
            .text(`${sanitize(stage.name)} (${sanitize(stage.type)})`, leftMargin, y);
          y += 14;
          const allKeys = new Set([
            ...Object.keys(stage.inputStream || {}),
            ...Object.keys(stage.outputStream || {}),
          ]);
          const adHeaders = ["Parameter", "Input", "Output"];
          const adRows = Array.from(allKeys).map(key => {
            const inp = stage.inputStream?.[key];
            const out = stage.outputStream?.[key];
            return [
              key.replace(/([A-Z])/g, " $1").trim(),
              inp ? `${fmtNum(inp.value)} ${inp.unit}` : "-",
              out ? `${fmtNum(out.value)} ${out.unit}` : "-",
            ];
          });
          y = drawTable(doc, adHeaders, adRows, leftMargin, y, [171, 171, 170]);
          y += 10;
        }
      }

      doc.addPage();
      y = 50;
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#1E3A5F")
        .text("Appendix B - CapEx Detail", leftMargin, y, { width: contentWidth });
      y += 25;

      if (capexResults.lineItems && capexResults.lineItems.length > 0) {
        y = addSectionHeader(doc, "CapEx Line Items", y, leftMargin, contentWidth);
        const capLiHeaders = ["Category", "Description", "Qty", "Unit Cost", "Total Cost"];
        const capLiRows = capexResults.lineItems.map(li => [
          sanitize(li.process),
          sanitize(li.equipmentType),
          String(li.quantity),
          fmtCurrency(li.baseCostPerUnit),
          fmtCurrency(li.totalCost),
        ]);
        y = drawTable(doc, capLiHeaders, capLiRows, leftMargin, y, [90, 140, 40, 116, 126], { fontSize: 7 });
        y += 15;
      }

      doc.addPage();
      y = 50;
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#1E3A5F")
        .text("Appendix C - OpEx Detail", leftMargin, y, { width: contentWidth });
      y += 25;

      if (opexResults.lineItems && opexResults.lineItems.length > 0) {
        y = addSectionHeader(doc, "OpEx Line Items", y, leftMargin, contentWidth);
        const opLiHeaders = ["Category", "Description", "Annual Cost", "Notes"];
        const opLiRows = opexResults.lineItems.map(li => [
          sanitize(li.category),
          sanitize(li.description),
          fmtCurrency(li.annualCost),
          sanitize(li.notes || ""),
        ]);
        y = drawTable(doc, opLiHeaders, opLiRows, leftMargin, y, [100, 170, 100, 142], { fontSize: 7 });
        y += 15;
      }

      doc.addPage();
      y = 50;
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#1E3A5F")
        .text("Appendix D - Pro-Forma Financial Projections", leftMargin, y, { width: contentWidth });
      y += 25;

      const assumptions = financialResults.assumptions;
      y = addSectionHeader(doc, "Financial Assumptions", y, leftMargin, contentWidth);
      const assumpRows: string[][] = [
        ["Inflation Rate", `${fmtNum(assumptions.inflationRate * 100)}%`],
        ["Project Life", `${assumptions.projectLifeYears} years`],
        ["Construction Period", `${assumptions.constructionMonths} months`],
        ["Uptime", `${fmtNum(assumptions.uptimePct * 100)}%`],
        ["RNG Price", `${fmtCurrency(assumptions.rngPricePerMMBtu)}/MMBtu`],
        ["RIN Price", `${fmtCurrency(assumptions.rinPricePerRIN)}/RIN`],
        ["Discount Rate", `${fmtNum(assumptions.discountRate * 100)}%`],
        ["ITC Rate", `${fmtNum(assumptions.itcRate * 100)}%`],
      ];
      y = drawTable(doc, ["Assumption", "Value"], assumpRows, leftMargin, y, [256, 256]);
      y += 15;

      if (financialResults.proForma && financialResults.proForma.length > 0) {
        if (y > 680) { doc.addPage(); y = 50; }
        y = addSectionHeader(doc, "Pro-Forma Projections ($000)", y, leftMargin, contentWidth);
        const pfHeaders = ["Year", "Cal Year", "RNG (MMBtu)", "Revenue", "OpEx", "EBITDA", "Net CF", "Cumul CF"];
        const pfRows = financialResults.proForma.map(pf => [
          String(pf.year),
          String(pf.calendarYear),
          fmtNum(pf.rngProductionMMBtu, 0),
          fmtNum(pf.totalRevenue / 1000, 0),
          fmtNum(pf.totalOpex / 1000, 0),
          fmtNum(pf.ebitda / 1000, 0),
          fmtNum(pf.netCashFlow / 1000, 0),
          fmtNum(pf.cumulativeCashFlow / 1000, 0),
        ]);
        y = drawTable(doc, pfHeaders, pfRows, leftMargin, y, [40, 55, 80, 72, 65, 65, 70, 65], { fontSize: 7 });
      }
    }

    addPageFooter();
    doc.end();
  });
}
