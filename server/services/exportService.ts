import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import type { MassBalanceResults, CalculationStep, TreatmentStage, ADProcessStage, EquipmentItem, CapexResults, CapexLineItem, CapexSummary, OpexResults, OpexLineItem, OpexSummary, VendorList, FinancialModelResults, FinancialMetrics, ProFormaYear, FinancialAssumptions, UpifRecord, FeedstockEntry, EnrichedFeedstockSpecRecord } from "@shared/schema";

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

function fmtCurrencyK(val: number): string {
  if (val === undefined || val === null || isNaN(val)) return "$0";
  const inK = Math.round(val / 1000);
  if (inK < 0) return `($${Math.abs(inK).toLocaleString("en-US")})`;
  return "$" + inK.toLocaleString("en-US");
}

function fmtDollarMillions(val: number): string {
  if (val === undefined || val === null || isNaN(val)) return "$0";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const formatted = m >= 100 ? `$${Math.round(m).toLocaleString("en-US")} million`
      : m >= 10 ? `$${m.toFixed(1)} million`
      : `$${m.toFixed(2)} million`;
    return val < 0 ? `(${formatted})` : formatted;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const formatted = `$${k.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}K`;
    return val < 0 ? `(${formatted})` : formatted;
  }
  return val < 0 ? `($${Math.abs(Math.round(val)).toLocaleString("en-US")})` : `$${Math.round(val).toLocaleString("en-US")}`;
}

function cleanDoubleDashes(str: string): string {
  return str.replace(/\s*--\s*/g, ", ").replace(/,\s*,/g, ",");
}

function buildExecutiveSummary(
  projectName: string,
  projectType: string,
  upifData: any,
  mbResults: MassBalanceResults,
  capexResults: CapexResults,
  opexResults: OpexResults,
  financialResults: FinancialModelResults,
): string {
  const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };
  const typeLabel = typeLabels[projectType] || projectType;
  const locationRaw = upifData?.location ? ` located in ${upifData.location}` : "";
  const location = cleanDoubleDashes(locationRaw);

  const feedstocks = upifData?.feedstocks;
  let feedstockDesc = "";
  if (feedstocks && Array.isArray(feedstocks) && feedstocks.length > 0) {
    const parts = feedstocks.map((fs: any) => {
      const vol = fs.feedstockVolume ? Number(fs.feedstockVolume).toLocaleString("en-US") : "";
      const unit = fs.feedstockUnit || "";
      const type = fs.feedstockType || "feedstock";
      return vol ? `${vol} ${unit} of ${type}` : type;
    });
    feedstockDesc = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  }

  const summary = mbResults?.summary || {} as any;
  const rngAnnualMMBtu = summary.rngEnergyAnnual?.value;
  const rngDailyMMBtu = summary.rngEnergyDaily?.value;
  const biogasScfm = summary.biogasProduction?.value;

  const metrics = financialResults?.metrics || {} as any;
  const totalCapex = metrics.totalCapex;
  const irr = metrics.irr;
  const payback = metrics.paybackYears;
  const npv = metrics.npv10;
  const annualOpex = opexResults?.summary?.totalAnnualOpex;

  let text = `${projectName} is a Type ${projectType} (${typeLabel}) project${location}`;

  if (feedstockDesc) {
    text += ` processing ${feedstockDesc}`;
  }
  text += ".";

  if (rngAnnualMMBtu || rngDailyMMBtu || biogasScfm) {
    text += " The facility is designed to produce";
    if (rngAnnualMMBtu) {
      const annual = Number(String(rngAnnualMMBtu).replace(/,/g, ""));
      text += ` ${fmtNum(annual, 0)} MMBTU/year of RNG`;
    } else if (rngDailyMMBtu) {
      text += ` ${fmtNum(Number(rngDailyMMBtu), 0)} MMBTU/day of RNG`;
    } else if (biogasScfm) {
      text += ` ${fmtNum(Number(biogasScfm), 0)} SCFM of biogas`;
    }
    text += ".";
  }

  if (totalCapex && !isNaN(totalCapex) && totalCapex > 0) {
    text += ` Total project cost is estimated at ${fmtDollarMillions(totalCapex)}`;
    if (annualOpex && !isNaN(annualOpex) && annualOpex > 0) text += ` with annual operating expenses of ${fmtDollarMillions(annualOpex)}`;
    text += ".";
  }

  if (irr !== null && irr !== undefined && !isNaN(irr)) {
    text += ` The project yields an IRR of ${fmtNum(irr * 100)}%`;
    if (payback !== null && payback !== undefined && !isNaN(payback)) text += `, a payback period of ${fmtNum(payback, 1)} years`;
    if (npv !== null && npv !== undefined && !isNaN(npv)) text += `, and an NPV at 10% of ${fmtDollarMillions(npv)}`;
    text += ".";
  }

  return cleanDoubleDashes(text);
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
  const headerBg = options?.headerBg || "#323F4F";
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
        .fillColor(bgColor === headerBg ? "#FFFFFF" : "#44546A")
        .text(cellText, x + cellPadding, y + cellPadding, {
          width: colWidths[i] - cellPadding * 2,
          lineBreak: true,
        });
      x += colWidths[i];
    }
    doc.rect(startX, y, tableWidth, rowH).lineWidth(0.5).strokeColor("#CFD1D4").stroke();
    y += rowH;
  };

  drawRow(headers, true, headerBg);
  rows.forEach((row, idx) => {
    const safeRow = row.map(cell => cell ?? "-");
    drawRow(safeRow, false, idx % 2 === 1 ? "#E9E9EB" : undefined);
  });
  return y;
}

function addSectionHeader(doc: InstanceType<typeof PDFDocument>, title: string, y: number, leftMargin: number, contentWidth: number): number {
  if (y > 700) {
    doc.addPage();
    y = 50;
  }
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#00B050")
    .text(title, leftMargin, y, { width: contentWidth });
  y += 20;
  doc.moveTo(leftMargin, y).lineTo(leftMargin + contentWidth, y).lineWidth(0.5).strokeColor("#CFD1D4").stroke();
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

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#323F4F")
      .text("Mass Balance Report", leftMargin, 50, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#8496B0")
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
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#44546A")
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
        doc.font("Helvetica").fontSize(8).fillColor("#8496B0")
          .text(`Convergence: ${results.convergenceAchieved ? "Yes" : "No"} (${results.convergenceIterations} iterations)`, leftMargin, y);
        y += 14;
      }
      for (const stage of results.stages) {
        if (y > 680) { doc.addPage(); y = 50; }
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#44546A")
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

    if (results.calculationSteps && results.calculationSteps.length > 0) {
      if (y > 500) { doc.addPage(); y = 50; }
      y = addSectionHeader(doc, "Calculation Steps", y, leftMargin, contentWidth);
      doc.font("Helvetica").fontSize(7).fillColor("#ADB9CA")
        .text("Step-by-step derivation of key results. Follow along to verify any value.", leftMargin, y);
      y += 12;
      const stepCategories = [...new Set(results.calculationSteps.map(s => s.category))];
      for (const cat of stepCategories) {
        if (y > 680) { doc.addPage(); y = 50; }
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#00B050").text(cat, leftMargin, y);
        y += 14;
        const catSteps = results.calculationSteps.filter(s => s.category === cat);
        const calcHeaders = ["Step", "Formula", "Result"];
        const calcRows = catSteps.map(step => {
          const inputsStr = step.inputs.map(inp => `${inp.name}=${inp.value} ${inp.unit}`).join(", ");
          return [
            sanitize(step.label),
            `${sanitize(step.formula)}\n[${inputsStr}]`,
            `${step.result.value} ${step.result.unit}${step.notes ? `\n${step.notes}` : ""}`,
          ];
        });
        const calcWidths = [140, 230, 142];
        y = drawTable(doc, calcHeaders, calcRows, leftMargin, y, calcWidths);
        y += 10;
      }
    }

    doc.end();
  });
}

const MB_HEADER_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FF323F4F" } };
const MB_HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const MB_SECTION_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B050" } };
const MB_SECTION_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
const MB_SUBSECTION_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6DCE4" } };
const MB_SUBSECTION_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FF323F4F" }, size: 11 };
const MB_BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFCFD1D4" } },
  bottom: { style: "thin", color: { argb: "FFCFD1D4" } },
  left: { style: "thin", color: { argb: "FFCFD1D4" } },
  right: { style: "thin", color: { argb: "FFCFD1D4" } },
};
const MB_ALT_ROW_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9EB" } };

function mbApplyTableHeaders(ws: ExcelJS.Worksheet, row: number, headers: string[], widths?: number[]): void {
  const r = ws.getRow(row);
  headers.forEach((h, i) => {
    const cell = r.getCell(i + 1);
    cell.value = h;
    cell.fill = MB_HEADER_FILL;
    cell.font = MB_HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = MB_BORDER_THIN;
  });
  r.height = 22;
  if (widths) {
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }
}

function mbAddSectionTitle(ws: ExcelJS.Worksheet, row: number, title: string, colSpan: number): void {
  const r = ws.getRow(row);
  const cell = r.getCell(1);
  cell.value = title;
  cell.fill = MB_SECTION_FILL;
  cell.font = MB_SECTION_FONT;
  cell.alignment = { horizontal: "left", vertical: "middle" };
  for (let c = 2; c <= colSpan; c++) {
    const fc = r.getCell(c);
    fc.fill = MB_SECTION_FILL;
    fc.border = MB_BORDER_THIN;
  }
  if (colSpan > 1) ws.mergeCells(row, 1, row, colSpan);
  r.height = 26;
}

function mbAddSubsectionTitle(ws: ExcelJS.Worksheet, row: number, title: string, colSpan: number): void {
  const r = ws.getRow(row);
  const cell = r.getCell(1);
  cell.value = title;
  cell.fill = MB_SUBSECTION_FILL;
  cell.font = MB_SUBSECTION_FONT;
  cell.alignment = { horizontal: "left", vertical: "middle" };
  for (let c = 2; c <= colSpan; c++) {
    const fc = r.getCell(c);
    fc.fill = MB_SUBSECTION_FILL;
    fc.border = MB_BORDER_THIN;
  }
  if (colSpan > 1) ws.mergeCells(row, 1, row, colSpan);
  r.height = 22;
}

function mbAddDataRow(ws: ExcelJS.Worksheet, row: number, values: (string | number | undefined)[], isAlt: boolean): void {
  const r = ws.getRow(row);
  values.forEach((v, i) => {
    const cell = r.getCell(i + 1);
    cell.value = v ?? "";
    cell.border = MB_BORDER_THIN;
    cell.alignment = { vertical: "middle", wrapText: true, horizontal: i === 0 ? "left" : "center" };
    if (isAlt) cell.fill = MB_ALT_ROW_FILL;
  });
  r.height = 18;
}

function mbFormatValue(val: string | number | undefined): string | number {
  if (val === undefined || val === null || val === "") return "";
  if (typeof val === "number") return val;
  const num = Number(val);
  if (!isNaN(num) && val.toString().trim() !== "") return num;
  return String(val);
}

function camelToTitle(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim();
}

export async function exportMassBalanceExcel(
  results: MassBalanceResults,
  scenarioName: string,
  projectName: string,
  projectType: string,
  upif?: UpifRecord | null
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Project Factory";
  wb.created = new Date();
  const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };

  // ==========================================
  // TAB 1: Input Parameters
  // ==========================================
  const wsInput = wb.addWorksheet("Input Parameters", { properties: { tabColor: { argb: "FF44546A" } } });
  let ir = 1;

  mbAddSectionTitle(wsInput, ir, "Input Parameters", 4);
  ir++;
  const infoHeaders = ["Field", "Value"];
  mbApplyTableHeaders(wsInput, ir, ["Field", "", "Value", ""], [20, 15, 30, 30]);
  ir++;
  const infoRows: [string, string][] = [
    ["Project", projectName],
    ["Scenario", scenarioName],
    ["Project Type", `${projectType} - ${typeLabels[projectType] || ""}`],
    ["Date Generated", new Date().toLocaleDateString("en-US")],
  ];
  if (upif?.location) infoRows.push(["Location", upif.location]);
  infoRows.forEach((row, idx) => {
    const r = wsInput.getRow(ir);
    r.getCell(1).value = row[0];
    r.getCell(1).font = { bold: true, size: 10 };
    r.getCell(1).border = MB_BORDER_THIN;
    r.getCell(1).alignment = { vertical: "middle" };
    wsInput.mergeCells(ir, 1, ir, 2);
    r.getCell(3).value = row[1];
    r.getCell(3).border = MB_BORDER_THIN;
    r.getCell(3).alignment = { vertical: "middle", wrapText: true };
    wsInput.mergeCells(ir, 3, ir, 4);
    if (idx % 2 === 1) {
      r.getCell(1).fill = MB_ALT_ROW_FILL;
      r.getCell(3).fill = MB_ALT_ROW_FILL;
    }
    r.height = 18;
    ir++;
  });
  ir++;

  if (upif?.feedstocks && upif.feedstocks.length > 0) {
    for (let fi = 0; fi < upif.feedstocks.length; fi++) {
      const fs = upif.feedstocks[fi];
      const fsLabel = upif.feedstocks.length > 1 ? `Feedstock ${fi + 1}: ${fs.feedstockType || "Unknown"}` : `Feedstock: ${fs.feedstockType || "Unknown"}`;
      mbAddSubsectionTitle(wsInput, ir, fsLabel, 4);
      ir++;

      if (fs.feedstockVolume) {
        const r = wsInput.getRow(ir);
        r.getCell(1).value = "Volume";
        r.getCell(1).font = { bold: true, size: 10 };
        r.getCell(1).border = MB_BORDER_THIN;
        wsInput.mergeCells(ir, 1, ir, 2);
        r.getCell(3).value = `${fs.feedstockVolume} ${fs.feedstockUnit || ""}`.trim();
        r.getCell(3).border = MB_BORDER_THIN;
        wsInput.mergeCells(ir, 3, ir, 4);
        r.height = 18;
        ir++;
      }

      if (fs.feedstockSpecs && Object.keys(fs.feedstockSpecs).length > 0) {
        mbApplyTableHeaders(wsInput, ir, ["Parameter", "Value", "Unit", "Source"], [25, 18, 15, 20]);
        ir++;
        const specEntries = Object.entries(fs.feedstockSpecs).sort((a, b) => (a[1].sortOrder || 0) - (b[1].sortOrder || 0));
        let currentGroup = "";
        specEntries.forEach(([key, spec], idx) => {
          if (spec.group && spec.group !== currentGroup) {
            currentGroup = spec.group;
            mbAddSubsectionTitle(wsInput, ir, currentGroup.charAt(0).toUpperCase() + currentGroup.slice(1), 4);
            ir++;
          }
          mbAddDataRow(wsInput, ir, [spec.displayName || key, mbFormatValue(spec.value), spec.unit || "", spec.source || ""], idx % 2 === 1);
          ir++;
        });
      } else if (fs.feedstockParameters && Object.keys(fs.feedstockParameters).length > 0) {
        mbApplyTableHeaders(wsInput, ir, ["Parameter", "Value", "Unit", ""], [25, 18, 15, 20]);
        ir++;
        Object.entries(fs.feedstockParameters).forEach(([key, val], idx) => {
          mbAddDataRow(wsInput, ir, [key, mbFormatValue(val.value), val.unit || "", ""], idx % 2 === 1);
          ir++;
        });
      }
      ir++;
    }
  } else if (upif?.feedstockType) {
    mbAddSubsectionTitle(wsInput, ir, `Feedstock: ${upif.feedstockType}`, 4);
    ir++;
    if (upif.feedstockVolume) {
      const r = wsInput.getRow(ir);
      r.getCell(1).value = "Volume";
      r.getCell(1).font = { bold: true, size: 10 };
      r.getCell(1).border = MB_BORDER_THIN;
      wsInput.mergeCells(ir, 1, ir, 2);
      r.getCell(3).value = `${upif.feedstockVolume} ${upif.feedstockUnit || ""}`.trim();
      r.getCell(3).border = MB_BORDER_THIN;
      wsInput.mergeCells(ir, 3, ir, 4);
      r.height = 18;
      ir++;
    }
    if (upif.feedstockSpecs && Object.keys(upif.feedstockSpecs).length > 0) {
      mbApplyTableHeaders(wsInput, ir, ["Parameter", "Value", "Unit", "Source"], [25, 18, 15, 20]);
      ir++;
      const specEntries = Object.entries(upif.feedstockSpecs).sort((a, b) => (a[1].sortOrder || 0) - (b[1].sortOrder || 0));
      specEntries.forEach(([key, spec], idx) => {
        mbAddDataRow(wsInput, ir, [spec.displayName || key, mbFormatValue(spec.value), spec.unit || "", spec.source || ""], idx % 2 === 1);
        ir++;
      });
    }
    ir++;
  }

  if (upif?.outputSpecs && Object.keys(upif.outputSpecs).length > 0) {
    mbAddSubsectionTitle(wsInput, ir, "Output / Acceptance Criteria", 4);
    ir++;
    mbApplyTableHeaders(wsInput, ir, ["Parameter", "Value", "Unit", "Source"], [25, 18, 15, 20]);
    ir++;
    let oIdx = 0;
    for (const [category, specs] of Object.entries(upif.outputSpecs)) {
      if (!specs || typeof specs !== "object") continue;
      mbAddSubsectionTitle(wsInput, ir, category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, " "), 4);
      ir++;
      const sortedSpecs = Object.entries(specs).sort((a, b) => (a[1]?.sortOrder || 0) - (b[1]?.sortOrder || 0));
      for (const [key, spec] of sortedSpecs) {
        if (!spec) continue;
        mbAddDataRow(wsInput, ir, [spec.displayName || key, mbFormatValue(spec.value), spec.unit || "", spec.source || ""], oIdx % 2 === 1);
        ir++;
        oIdx++;
      }
    }
    ir++;
  }

  if (upif?.constraints && upif.constraints.length > 0) {
    mbAddSubsectionTitle(wsInput, ir, "Constraints", 4);
    ir++;
    upif.constraints.forEach((c, idx) => {
      const r = wsInput.getRow(ir);
      r.getCell(1).value = `${idx + 1}.`;
      r.getCell(1).font = { bold: true, size: 10 };
      r.getCell(1).border = MB_BORDER_THIN;
      r.getCell(2).value = c;
      r.getCell(2).border = MB_BORDER_THIN;
      r.getCell(2).alignment = { wrapText: true };
      wsInput.mergeCells(ir, 2, ir, 4);
      if (idx % 2 === 1) {
        r.getCell(1).fill = MB_ALT_ROW_FILL;
        r.getCell(2).fill = MB_ALT_ROW_FILL;
      }
      r.height = 18;
      ir++;
    });
  }

  wsInput.getColumn(1).width = 20;
  wsInput.getColumn(2).width = 15;
  wsInput.getColumn(3).width = 30;
  wsInput.getColumn(4).width = 22;

  // ==========================================
  // TAB 2: Mass Balance (separate tables per train)
  // ==========================================
  const wsMB = wb.addWorksheet("Mass Balance", { properties: { tabColor: { argb: "FF00B050" } } });
  let mr = 1;

  mbAddSectionTitle(wsMB, mr, `Mass Balance — ${projectName} / ${scenarioName}`, 6);
  mr++;
  const metaRow = wsMB.getRow(mr);
  metaRow.getCell(1).value = `Type ${projectType}: ${typeLabels[projectType] || ""}`;
  metaRow.getCell(1).font = { italic: true, size: 10, color: { argb: "FF8496B0" } };
  metaRow.getCell(4).value = `Generated: ${new Date().toLocaleDateString("en-US")}`;
  metaRow.getCell(4).font = { italic: true, size: 10, color: { argb: "FF8496B0" } };
  mr += 2;

  if (results.summary && Object.keys(results.summary).length > 0) {
    mbAddSubsectionTitle(wsMB, mr, "Summary", 6);
    mr++;
    mbApplyTableHeaders(wsMB, mr, ["Parameter", "Value", "Unit"], [35, 22, 18]);
    mr++;
    Object.entries(results.summary).forEach(([key, val], idx) => {
      mbAddDataRow(wsMB, mr, [camelToTitle(key), mbFormatValue(val?.value), val?.unit ?? ""], idx % 2 === 1);
      mr++;
    });
    mr += 2;
  }

  if (results.adStages && results.adStages.length > 0) {
    for (const stage of results.adStages) {
      mbAddSubsectionTitle(wsMB, mr, `${stage.name} (${stage.type})`, 6);
      mr++;
      mbApplyTableHeaders(wsMB, mr, ["Parameter", "Input Value", "Input Unit", "Output Value", "Output Unit"], [30, 18, 15, 18, 15]);
      mr++;
      const allKeys = new Set([
        ...Object.keys(stage.inputStream || {}),
        ...Object.keys(stage.outputStream || {}),
      ]);
      let sIdx = 0;
      for (const key of allKeys) {
        const inp = stage.inputStream?.[key];
        const out = stage.outputStream?.[key];
        mbAddDataRow(wsMB, mr, [
          camelToTitle(key),
          inp?.value !== undefined ? mbFormatValue(inp.value) : "",
          inp?.unit ?? "",
          out?.value !== undefined ? mbFormatValue(out.value) : "",
          out?.unit ?? "",
        ], sIdx % 2 === 1);
        mr++;
        sIdx++;
      }
      mr += 2;
    }
  }

  if (results.stages && results.stages.length > 0) {
    for (const stage of results.stages) {
      mbAddSubsectionTitle(wsMB, mr, `${stage.name} (${stage.type})`, 6);
      mr++;
      mbApplyTableHeaders(wsMB, mr, ["Parameter", "Influent", "Effluent", "Removal %"], [25, 18, 18, 15]);
      mr++;
      const params = ["flow", "bod", "cod", "tss", "tkn", "tp", "fog", "nh3", "no3"] as const;
      const paramLabels: Record<string, string> = {
        flow: "Flow (GPD)", bod: "BOD (mg/L)", cod: "COD (mg/L)", tss: "TSS (mg/L)",
        tkn: "TKN (mg/L)", tp: "TP (mg/L)", fog: "FOG (mg/L)", nh3: "NH₃ (mg/L)", no3: "NO₃ (mg/L)",
      };
      let sIdx = 0;
      for (const p of params) {
        const infVal = stage.influent[p];
        const effVal = stage.effluent[p];
        if (infVal === undefined && effVal === undefined) continue;
        const remVal = stage.removalEfficiencies[p];
        mbAddDataRow(wsMB, mr, [
          paramLabels[p] || p.toUpperCase(),
          infVal !== undefined ? mbFormatValue(infVal) : "",
          effVal !== undefined ? mbFormatValue(effVal) : "",
          remVal !== undefined ? `${typeof remVal === "number" ? remVal.toFixed(1) : remVal}%` : "",
        ], sIdx % 2 === 1);
        mr++;
        sIdx++;
      }

      if (stage.designCriteria && Object.keys(stage.designCriteria).length > 0) {
        mr++;
        const dcRow = wsMB.getRow(mr);
        dcRow.getCell(1).value = "Design Criteria";
        dcRow.getCell(1).font = { bold: true, italic: true, size: 10, color: { argb: "FF323F4F" } };
        mr++;
        mbApplyTableHeaders(wsMB, mr, ["Criterion", "Value", "Unit", "Source"], [25, 18, 15, 20]);
        mr++;
        Object.entries(stage.designCriteria).forEach(([key, dc], idx) => {
          mbAddDataRow(wsMB, mr, [camelToTitle(key), mbFormatValue(dc.value), dc.unit || "", dc.source || ""], idx % 2 === 1);
          mr++;
        });
      }
      mr += 2;
    }
  }

  if (results.recycleStreams && results.recycleStreams.length > 0) {
    mbAddSubsectionTitle(wsMB, mr, "Recycle Streams", 6);
    mr++;
    mbApplyTableHeaders(wsMB, mr, ["Stream", "Source", "Destination", "Flow", "Loads"], [25, 20, 20, 15, 30]);
    mr++;
    results.recycleStreams.forEach((rs, idx) => {
      const loadsStr = rs.loads ? Object.entries(rs.loads).map(([k, v]) => `${k}: ${v}`).join(", ") : "";
      mbAddDataRow(wsMB, mr, [rs.name, rs.source, rs.destination, mbFormatValue(rs.flow), loadsStr], idx % 2 === 1);
      mr++;
    });
    mr++;
  }

  wsMB.getColumn(1).width = 35;
  wsMB.getColumn(2).width = 22;
  wsMB.getColumn(3).width = 18;
  wsMB.getColumn(4).width = 22;
  wsMB.getColumn(5).width = 18;
  wsMB.getColumn(6).width = 18;

  // ==========================================
  // TAB 3: Equipment List
  // ==========================================
  const wsEq = wb.addWorksheet("Equipment List", { properties: { tabColor: { argb: "FF008250" } } });
  let er = 1;

  mbAddSectionTitle(wsEq, er, "Equipment List", 7);
  er++;

  if (results.equipment && results.equipment.length > 0) {
    const eqHeaders = ["#", "Process", "Equipment Type", "Qty", "Description", "Design Basis", "Notes"];
    const eqWidths = [5, 22, 22, 7, 38, 32, 32];
    mbApplyTableHeaders(wsEq, er, eqHeaders, eqWidths);
    er++;

    results.equipment.forEach((eq, idx) => {
      const r = wsEq.getRow(er);
      const vals = [idx + 1, eq.process, eq.equipmentType, eq.quantity, eq.description, eq.designBasis, eq.notes];
      vals.forEach((v, i) => {
        const cell = r.getCell(i + 1);
        cell.value = v ?? "";
        cell.border = MB_BORDER_THIN;
        cell.alignment = { vertical: "middle", wrapText: true, horizontal: i <= 3 ? "center" : "left" };
        if (idx % 2 === 1) cell.fill = MB_ALT_ROW_FILL;
      });
      r.height = 22;
      er++;
    });

    er += 2;
    const totalRow = wsEq.getRow(er);
    totalRow.getCell(1).value = `Total Equipment Items: ${results.equipment.length}`;
    totalRow.getCell(1).font = { bold: true, size: 10 };
    wsEq.mergeCells(er, 1, er, 3);
  } else {
    const r = wsEq.getRow(er);
    r.getCell(1).value = "No equipment data available.";
    r.getCell(1).font = { italic: true, color: { argb: "FFADB9CA" } };
  }

  // ==========================================
  // TAB 4: Assumptions & Calculations
  // ==========================================
  const wsCalc = wb.addWorksheet("Assumptions & Calculations", { properties: { tabColor: { argb: "FF8496B0" } } });
  let cr = 1;

  mbAddSectionTitle(wsCalc, cr, "Design Assumptions", 4);
  cr++;

  if (results.assumptions && results.assumptions.length > 0) {
    mbApplyTableHeaders(wsCalc, cr, ["#", "Parameter", "Value", "Source"], [5, 35, 25, 30]);
    cr++;
    results.assumptions.forEach((a, idx) => {
      const r = wsCalc.getRow(cr);
      const vals = [idx + 1, a.parameter, a.value, a.source];
      vals.forEach((v, i) => {
        const cell = r.getCell(i + 1);
        cell.value = v ?? "";
        cell.border = MB_BORDER_THIN;
        cell.alignment = { vertical: "middle", wrapText: true, horizontal: i === 0 ? "center" : "left" };
        if (idx % 2 === 1) cell.fill = MB_ALT_ROW_FILL;
      });
      r.height = 18;
      cr++;
    });
  } else {
    const r = wsCalc.getRow(cr);
    r.getCell(1).value = "No assumptions recorded.";
    r.getCell(1).font = { italic: true, color: { argb: "FFADB9CA" } };
    cr++;
  }

  cr += 2;
  mbAddSectionTitle(wsCalc, cr, "Convergence & Calculation Notes", 4);
  cr++;
  const convRow = wsCalc.getRow(cr);
  convRow.getCell(1).value = "Convergence Achieved";
  convRow.getCell(1).font = { bold: true, size: 10 };
  convRow.getCell(1).border = MB_BORDER_THIN;
  convRow.getCell(2).value = results.convergenceAchieved ? "Yes" : "No";
  convRow.getCell(2).border = MB_BORDER_THIN;
  convRow.getCell(2).font = { color: { argb: results.convergenceAchieved ? "FF2E7D32" : "FFCC0000" }, bold: true };
  cr++;
  const iterRow = wsCalc.getRow(cr);
  iterRow.getCell(1).value = "Iterations";
  iterRow.getCell(1).font = { bold: true, size: 10 };
  iterRow.getCell(1).border = MB_BORDER_THIN;
  iterRow.getCell(2).value = results.convergenceIterations ?? 0;
  iterRow.getCell(2).border = MB_BORDER_THIN;
  cr++;

  if (results.warnings && results.warnings.length > 0) {
    cr += 2;
    mbAddSectionTitle(wsCalc, cr, "Warnings & Notes", 4);
    cr++;
    mbApplyTableHeaders(wsCalc, cr, ["Severity", "Field", "Message", ""], [12, 20, 50, 10]);
    cr++;
    results.warnings.forEach((w, idx) => {
      const r = wsCalc.getRow(cr);
      r.getCell(1).value = (w.severity || "info").toUpperCase();
      r.getCell(1).border = MB_BORDER_THIN;
      r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      r.getCell(1).font = {
        bold: true,
        color: { argb: w.severity === "error" ? "FFCC0000" : w.severity === "warning" ? "FFFF8800" : "FF2E7D32" },
      };
      r.getCell(2).value = w.field || "";
      r.getCell(2).border = MB_BORDER_THIN;
      r.getCell(3).value = w.message || "";
      r.getCell(3).border = MB_BORDER_THIN;
      r.getCell(3).alignment = { wrapText: true };
      if (idx % 2 === 1) {
        r.getCell(1).fill = MB_ALT_ROW_FILL;
        r.getCell(2).fill = MB_ALT_ROW_FILL;
        r.getCell(3).fill = MB_ALT_ROW_FILL;
      }
      r.height = 18;
      cr++;
    });
  }

  if (results.calculationSteps && results.calculationSteps.length > 0) {
    cr += 2;
    mbAddSectionTitle(wsCalc, cr, "Calculation Steps", 6);
    cr++;
    const stepCategories = [...new Set(results.calculationSteps.map(s => s.category))];
    for (const cat of stepCategories) {
      mbAddSubsectionTitle(wsCalc, cr, cat, 6);
      cr++;
      mbApplyTableHeaders(wsCalc, cr, ["Step", "Formula", "Inputs", "Result", "Unit", "Notes"], [25, 40, 45, 18, 15, 35]);
      cr++;
      const catSteps = results.calculationSteps.filter(s => s.category === cat);
      catSteps.forEach((step, idx) => {
        const r = wsCalc.getRow(cr);
        const inputsStr = step.inputs.map(inp => `${inp.name} = ${inp.value} ${inp.unit}`).join("; ");
        const vals = [step.label, step.formula, inputsStr, step.result.value, step.result.unit, step.notes || ""];
        vals.forEach((v, i) => {
          const cell = r.getCell(i + 1);
          cell.value = v ?? "";
          cell.border = MB_BORDER_THIN;
          cell.alignment = { vertical: "middle", wrapText: true, horizontal: i === 3 ? "right" : "left" };
          cell.font = { size: 9 };
          if (i === 1) cell.font = { size: 9, italic: true };
          if (i === 3) cell.font = { size: 9, bold: true };
          if (idx % 2 === 1) cell.fill = MB_ALT_ROW_FILL;
        });
        r.height = 22;
        cr++;
      });
      cr++;
    }
  }

  wsCalc.getColumn(1).width = 25;
  wsCalc.getColumn(2).width = 40;
  wsCalc.getColumn(3).width = 45;
  wsCalc.getColumn(4).width = 18;
  wsCalc.getColumn(5).width = 15;
  wsCalc.getColumn(6).width = 35;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
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

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#323F4F")
      .text("Capital Cost Estimate", leftMargin, 50, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#8496B0")
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
        ["Subtotal Direct Costs (EPC)", fmtCurrency(summary.subtotalDirectCosts ?? summary.totalInstalledCost)],
      ];
      if (summary.subtotalInternalCosts !== undefined) sumRows.push(["Internal Costs", fmtCurrency(summary.subtotalInternalCosts)]);
      if (summary.contingency !== undefined) sumRows.push(["Contingency (7.5%)", fmtCurrency(summary.contingency)]);
      if (summary.devCosts !== undefined) sumRows.push(["Development Costs", fmtCurrency(summary.devCosts)]);
      if (summary.spareParts !== undefined) sumRows.push(["Spare Parts (2.5% of equipment)", fmtCurrency(summary.spareParts)]);
      if (summary.insurance !== undefined) sumRows.push(["Insurance (1.5% of direct costs)", fmtCurrency(summary.insurance)]);
      if (summary.escalation !== undefined) sumRows.push(["CPI Escalation", fmtCurrency(summary.escalation)]);
      sumRows.push(["Total Project Cost", fmtCurrency(summary.totalProjectCost)]);
      if (summary.costPerUnit) {
        sumRows.push([`Cost per Unit (${summary.costPerUnit.basis})`, `${fmtCurrency(summary.costPerUnit.value)} / ${summary.costPerUnit.unit}`]);
      }
      y = drawTable(doc, ["Item", "Amount"], sumRows, leftMargin, y, [300, 212], { headerBg: "#323F4F" });
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
      doc.font("Helvetica").fontSize(9).fillColor("#44546A")
        .text(sanitize(results.methodology), leftMargin, y, { width: contentWidth, lineGap: 2 });
    }

    doc.end();
  });
}

const CX_HEADER_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FF323F4F" } };
const CX_HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
const CX_SECTION_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B050" } };
const CX_SECTION_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const CX_SUBTOTAL_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
const CX_SUBTOTAL_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
const CX_TOTAL_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E7D32" } };
const CX_TOTAL_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const CX_CURRENCY_FMT = '#,##0';
const CX_CURRENCY_DOLLAR_FMT = '$#,##0';
const CX_PCT_FMT = '0.00%';

function cxApplyHeaders(ws: ExcelJS.Worksheet, row: number, headers: string[], widths: number[]): void {
  const r = ws.getRow(row);
  headers.forEach((h, i) => {
    const cell = r.getCell(i + 1);
    cell.value = h;
    cell.fill = CX_HEADER_FILL;
    cell.font = CX_HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = MB_BORDER_THIN;
  });
  r.height = 22;
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

function cxAddSectionRow(ws: ExcelJS.Worksheet, row: number, title: string, colSpan: number): void {
  const r = ws.getRow(row);
  const cell = r.getCell(1);
  cell.value = title;
  cell.fill = CX_SECTION_FILL;
  cell.font = CX_SECTION_FONT;
  cell.alignment = { horizontal: "left", vertical: "middle" };
  for (let c = 2; c <= colSpan; c++) {
    const fc = r.getCell(c);
    fc.fill = CX_SECTION_FILL;
    fc.border = MB_BORDER_THIN;
  }
  if (colSpan > 1) ws.mergeCells(row, 1, row, colSpan);
  r.height = 24;
}

function cxAddSubtotalRow(ws: ExcelJS.Worksheet, row: number, label: string, amount: number, colSpan: number, fill: ExcelJS.FillPattern, font: Partial<ExcelJS.Font>): void {
  const r = ws.getRow(row);
  const labelCell = r.getCell(1);
  labelCell.value = label;
  labelCell.fill = fill;
  labelCell.font = font;
  labelCell.alignment = { horizontal: "left", vertical: "middle" };
  for (let c = 2; c < colSpan; c++) {
    const fc = r.getCell(c);
    fc.fill = fill;
    fc.border = MB_BORDER_THIN;
  }
  if (colSpan > 2) ws.mergeCells(row, 1, row, colSpan - 1);
  const amtCell = r.getCell(colSpan);
  amtCell.value = amount;
  amtCell.numFmt = CX_CURRENCY_DOLLAR_FMT;
  amtCell.fill = fill;
  amtCell.font = font;
  amtCell.alignment = { horizontal: "right", vertical: "middle" };
  amtCell.border = MB_BORDER_THIN;
  r.height = 24;
}

function cxAddDataRow(ws: ExcelJS.Worksheet, row: number, values: (string | number | undefined)[], isAlt: boolean, currencyCols: number[] = []): void {
  const r = ws.getRow(row);
  values.forEach((v, i) => {
    const cell = r.getCell(i + 1);
    cell.value = v ?? "";
    cell.border = MB_BORDER_THIN;
    cell.alignment = { vertical: "middle", wrapText: true, horizontal: i === 0 ? "left" : (currencyCols.includes(i) ? "right" : "center") };
    cell.font = { size: 10 };
    if (isAlt) cell.fill = MB_ALT_ROW_FILL;
    if (currencyCols.includes(i) && typeof v === "number") {
      cell.numFmt = CX_CURRENCY_FMT;
    }
  });
  r.height = 18;
}

export async function exportCapexExcel(
  results: CapexResults,
  scenarioName: string,
  projectName: string,
  projectType: string
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Project Factory — Burnham";
  wb.created = new Date();
  const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };
  const directProcesses = ["Major Equipment", "Construction Directs", "Construction Mgmt & Indirects", "Interconnect"];

  const wsSummary = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF323F4F" } } });
  let sr = 1;

  cxAddSectionRow(wsSummary, sr, "Capital Cost Estimate", 3);
  sr++;
  const infoData: [string, string][] = [
    ["Project", projectName],
    ["Scenario", scenarioName],
    ["Project Type", `${projectType} - ${typeLabels[projectType] || ""}`],
    ["Cost Year", results.costYear || "Current"],
    ["Currency", results.currency || "USD"],
    ["Date Generated", new Date().toLocaleDateString("en-US")],
  ];
  cxApplyHeaders(wsSummary, sr, ["Field", "", "Value"], [30, 15, 25]);
  sr++;
  infoData.forEach((row, idx) => {
    const r = wsSummary.getRow(sr);
    r.getCell(1).value = row[0];
    r.getCell(1).font = { bold: true, size: 10 };
    r.getCell(1).border = MB_BORDER_THIN;
    r.getCell(1).alignment = { vertical: "middle" };
    wsSummary.mergeCells(sr, 1, sr, 2);
    r.getCell(3).value = row[1];
    r.getCell(3).border = MB_BORDER_THIN;
    r.getCell(3).alignment = { vertical: "middle" };
    if (idx % 2 === 1) {
      r.getCell(1).fill = MB_ALT_ROW_FILL;
      r.getCell(3).fill = MB_ALT_ROW_FILL;
    }
    r.height = 18;
    sr++;
  });
  sr++;

  const summary = results.summary;
  if (summary) {
    cxApplyHeaders(wsSummary, sr, ["Cost Category", "", "Amount ($)"], [30, 15, 25]);
    sr++;

    const isDeterministic = summary.subtotalDirectCosts != null;
    const equipmentCost = summary.totalEquipmentCost || 0;
    const totalDirectCosts = isDeterministic
      ? (summary.subtotalDirectCosts || 0)
      : (summary.totalInstalledCost || 0);
    const installationCost = totalDirectCosts - equipmentCost;
    const engCost = summary.engineeringCost || 0;
    const contingencyAmt = isDeterministic
      ? (summary.contingency ?? summary.totalContingency ?? 0)
      : (summary.totalContingency || 0);
    const totalCapitalCosts = summary.totalProjectCost || 0;
    const otherIndirect = Math.max(totalCapitalCosts - totalDirectCosts - engCost - contingencyAmt, 0);

    const addSummaryDataRow = (label: string, amount: number, isAlt: boolean) => {
      const r = wsSummary.getRow(sr);
      r.getCell(1).value = label;
      r.getCell(1).font = { size: 10 };
      r.getCell(1).border = MB_BORDER_THIN;
      r.getCell(1).alignment = { vertical: "middle" };
      wsSummary.mergeCells(sr, 1, sr, 2);
      r.getCell(3).value = amount;
      r.getCell(3).numFmt = CX_CURRENCY_DOLLAR_FMT;
      r.getCell(3).border = MB_BORDER_THIN;
      r.getCell(3).alignment = { vertical: "middle", horizontal: "right" };
      r.getCell(3).font = { size: 10 };
      if (isAlt) {
        r.getCell(1).fill = MB_ALT_ROW_FILL;
        r.getCell(3).fill = MB_ALT_ROW_FILL;
      }
      r.height = 18;
      sr++;
    };

    addSummaryDataRow("Equipment", equipmentCost, false);
    addSummaryDataRow("Installation", installationCost, true);
    cxAddSubtotalRow(wsSummary, sr, "Total Direct Costs", totalDirectCosts, 3, CX_SUBTOTAL_FILL, CX_SUBTOTAL_FONT);
    sr++;
    addSummaryDataRow(`Engineering (${summary.engineeringPct || 7}%)`, engCost, false);
    addSummaryDataRow("Other Indirect Costs", otherIndirect, true);
    addSummaryDataRow("Contingency (7.5%)", contingencyAmt, false);
    cxAddSubtotalRow(wsSummary, sr, "Total Capital Costs", totalCapitalCosts, 3, CX_TOTAL_FILL, CX_TOTAL_FONT);
    sr++;

    if (summary.costPerUnit) {
      sr++;
      const r = wsSummary.getRow(sr);
      r.getCell(1).value = `Cost per Unit (${summary.costPerUnit.unit})`;
      r.getCell(1).font = { bold: true, size: 10 };
      r.getCell(1).border = MB_BORDER_THIN;
      wsSummary.mergeCells(sr, 1, sr, 2);
      r.getCell(3).value = summary.costPerUnit.value;
      r.getCell(3).numFmt = CX_CURRENCY_DOLLAR_FMT;
      r.getCell(3).border = MB_BORDER_THIN;
      r.getCell(3).alignment = { horizontal: "right" };
      r.height = 18;
      sr++;
      const rb = wsSummary.getRow(sr);
      rb.getCell(1).value = `Basis: ${summary.costPerUnit.basis}`;
      rb.getCell(1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
      wsSummary.mergeCells(sr, 1, sr, 3);
    }
  }

  const wsLI = wb.addWorksheet("Line Items", { properties: { tabColor: { argb: "FF00B050" } } });
  let lr = 1;
  cxAddSectionRow(wsLI, lr, "Capital Cost Estimate — Line Items", 10);
  lr++;
  const liHeaders = ["Equipment Type", "Description", "Qty", "Base Cost/Unit ($)", "Install Factor", "Installed Cost ($)", "Contingency %", "Contingency ($)", "Total Cost ($)", "Source"];
  const liWidths = [25, 35, 8, 18, 12, 18, 12, 16, 18, 25];
  cxApplyHeaders(wsLI, lr, liHeaders, liWidths);
  lr++;

  const currCols = [3, 5, 7, 8];
  let lastProcess = "";
  let directSubtotal = 0;
  let directsDone = false;
  const lineItems = results.lineItems || [];

  lineItems.forEach((li, idx) => {
    if (!directsDone && !directProcesses.includes(li.process) && directSubtotal > 0) {
      directsDone = true;
      cxAddSubtotalRow(wsLI, lr, "Subtotal Direct Costs (EPC)", directSubtotal, 10, CX_SUBTOTAL_FILL, CX_SUBTOTAL_FONT);
      lr++;
    }

    if (directProcesses.includes(li.process)) {
      directSubtotal += li.totalCost;
    }

    if (li.process !== lastProcess) {
      lastProcess = li.process;
      const r = wsLI.getRow(lr);
      const cell = r.getCell(1);
      cell.value = li.process;
      cell.fill = MB_SUBSECTION_FILL;
      cell.font = MB_SUBSECTION_FONT;
      cell.alignment = { horizontal: "left", vertical: "middle" };
      for (let c = 2; c <= 10; c++) {
        const fc = r.getCell(c);
        fc.fill = MB_SUBSECTION_FILL;
        fc.border = MB_BORDER_THIN;
      }
      wsLI.mergeCells(lr, 1, lr, 10);
      r.height = 22;
      lr++;
    }

    cxAddDataRow(wsLI, lr, [
      li.equipmentType,
      li.description,
      li.quantity,
      li.baseCostPerUnit,
      li.installationFactor,
      li.installedCost,
      li.contingencyPct,
      li.contingencyCost,
      li.totalCost,
      li.source,
    ], idx % 2 === 1, currCols);
    lr++;
  });

  if (summary) {
    cxAddSubtotalRow(wsLI, lr, "Total Capital Costs", summary.totalProjectCost, 10, CX_TOTAL_FILL, CX_TOTAL_FONT);
    lr++;
  }

  if (results.assumptions && results.assumptions.length > 0) {
    const wsAss = wb.addWorksheet("Assumptions", { properties: { tabColor: { argb: "FF44546A" } } });
    let ar = 1;
    cxAddSectionRow(wsAss, ar, "Cost Assumptions", 3);
    ar++;
    cxApplyHeaders(wsAss, ar, ["Parameter", "Value", "Source"], [30, 30, 30]);
    ar++;
    results.assumptions.forEach((a, idx) => {
      cxAddDataRow(wsAss, ar, [a.parameter, a.value, a.source], idx % 2 === 1);
      ar++;
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
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

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#323F4F")
      .text("Annual Operating Cost Estimate", leftMargin, 50, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#8496B0")
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
      y = drawTable(doc, ["Item", "Amount"], sumRows, leftMargin, y, [300, 212], { headerBg: "#323F4F" });
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
      doc.font("Helvetica").fontSize(9).fillColor("#44546A")
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

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#323F4F")
      .text("Recommended Vendor List", leftMargin, 50, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#8496B0")
      .text(`Project: ${sanitize(projectName)}`, leftMargin, 75, { align: "center", width: contentWidth })
      .text(`Scenario: ${sanitize(scenarioName)}`, leftMargin, 88, { align: "center", width: contentWidth })
      .text(`Type ${projectType}: ${typeLabels[projectType] || projectType}`, leftMargin, 101, { align: "center", width: contentWidth })
      .text(`Generated: ${vendorList.generatedAt ? new Date(vendorList.generatedAt).toLocaleDateString("en-US") : new Date().toLocaleDateString("en-US")}`, leftMargin, 114, { align: "center", width: contentWidth })
      .text(`Model: ${sanitize(vendorList.modelUsed || "")}`, leftMargin, 127, { align: "center", width: contentWidth });

    let y = 155;

    for (const item of vendorList.items) {
      if (y > 650) { doc.addPage(); y = 50; }

      doc.rect(leftMargin, y, contentWidth, 22).fill("#00B050");
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF")
        .text(`${sanitize(item.equipmentType)} — ${sanitize(item.process)}`, leftMargin + 8, y + 5, { width: contentWidth - 16 });
      y += 26;

      doc.font("Helvetica").fontSize(8).fillColor("#44546A")
        .text(`Quantity: ${item.quantity}`, leftMargin + 8, y);
      y += 12;
      if (item.specsSummary) {
        doc.font("Helvetica").fontSize(8).fillColor("#44546A")
          .text(`Specs: ${sanitize(item.specsSummary)}`, leftMargin + 8, y, { width: contentWidth - 16 });
        y += doc.heightOfString(`Specs: ${sanitize(item.specsSummary)}`, { width: contentWidth - 16 }) + 4;
      }

      if (item.recommendations && item.recommendations.length > 0) {
        for (let rIdx = 0; rIdx < item.recommendations.length; rIdx++) {
          const rec = item.recommendations[rIdx];
          if (y > 640) { doc.addPage(); y = 50; }

          y += 4;
          doc.font("Helvetica-Bold").fontSize(8).fillColor("#323F4F")
            .text(`${rIdx + 1}. ${sanitize(rec.manufacturer)} — ${sanitize(rec.modelNumber)}`, leftMargin + 8, y, { width: contentWidth - 16 });
          y += 12;

          if (rec.websiteUrl || rec.specSheetUrl) {
            doc.font("Helvetica").fontSize(7).fillColor("#4472C4")
              .text(sanitize(rec.websiteUrl || rec.specSheetUrl || ""), leftMargin + 16, y, { width: contentWidth - 24, link: rec.websiteUrl || rec.specSheetUrl });
            y += 10;
          }

          if (rec.notes) {
            doc.font("Helvetica").fontSize(7).fillColor("#44546A")
              .text(sanitize(rec.notes), leftMargin + 16, y, { width: contentWidth - 24 });
            y += doc.heightOfString(sanitize(rec.notes), { width: contentWidth - 24 }) + 2;
          }

          if (rec.strengths) {
            if (y > 700) { doc.addPage(); y = 50; }
            doc.font("Helvetica-Bold").fontSize(7).fillColor("#00B050")
              .text("Strengths: ", leftMargin + 16, y, { continued: true, width: contentWidth - 24 });
            doc.font("Helvetica").fontSize(7).fillColor("#44546A")
              .text(sanitize(rec.strengths), { width: contentWidth - 24 });
            y += doc.heightOfString(`Strengths: ${sanitize(rec.strengths)}`, { width: contentWidth - 24 }) + 2;
          }

          if (rec.weaknesses) {
            if (y > 700) { doc.addPage(); y = 50; }
            doc.font("Helvetica-Bold").fontSize(7).fillColor("#C00000")
              .text("Weaknesses: ", leftMargin + 16, y, { continued: true, width: contentWidth - 24 });
            doc.font("Helvetica").fontSize(7).fillColor("#44546A")
              .text(sanitize(rec.weaknesses), { width: contentWidth - 24 });
            y += doc.heightOfString(`Weaknesses: ${sanitize(rec.weaknesses)}`, { width: contentWidth - 24 }) + 2;
          }

          if (rec.considerations) {
            if (y > 700) { doc.addPage(); y = 50; }
            doc.font("Helvetica-Bold").fontSize(7).fillColor("#ED7D31")
              .text("Considerations: ", leftMargin + 16, y, { continued: true, width: contentWidth - 24 });
            doc.font("Helvetica").fontSize(7).fillColor("#44546A")
              .text(sanitize(rec.considerations), { width: contentWidth - 24 });
            y += doc.heightOfString(`Considerations: ${sanitize(rec.considerations)}`, { width: contentWidth - 24 }) + 2;
          }

          y += 4;
        }
      }

      y += 12;
    }

    doc.end();
  });
}

export function exportVendorListExcel(
  vendorList: VendorList,
  scenarioName: string,
  projectName: string,
  projectType: string
): Buffer {
  const wb = XLSX.utils.book_new();

  const headers = [
    "Equipment Type", "Process", "Qty", "Specs Summary",
    "#", "Manufacturer", "Model Number", "Website",
    "Notes", "Strengths", "Weaknesses", "Considerations"
  ];

  const rows: any[][] = [headers];

  for (const item of vendorList.items) {
    if (item.recommendations && item.recommendations.length > 0) {
      for (let rIdx = 0; rIdx < item.recommendations.length; rIdx++) {
        const rec = item.recommendations[rIdx];
        rows.push([
          rIdx === 0 ? item.equipmentType : "",
          rIdx === 0 ? item.process : "",
          rIdx === 0 ? item.quantity : "",
          rIdx === 0 ? item.specsSummary : "",
          rIdx + 1,
          rec.manufacturer,
          rec.modelNumber,
          rec.websiteUrl || rec.specSheetUrl || "",
          rec.notes || "",
          rec.strengths || "",
          rec.weaknesses || "",
          rec.considerations || "",
        ]);
      }
    } else {
      rows.push([item.equipmentType, item.process, item.quantity, item.specsSummary, "", "", "", "", "", "", "", ""]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws["!cols"] = [
    { wch: 25 }, { wch: 18 }, { wch: 5 }, { wch: 40 },
    { wch: 4 }, { wch: 20 }, { wch: 22 }, { wch: 35 },
    { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 40 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Vendor List");

  const infoData = [
    ["Project", projectName],
    ["Scenario", scenarioName],
    ["Project Type", `Type ${projectType}`],
    ["Generated", vendorList.generatedAt ? new Date(vendorList.generatedAt).toLocaleDateString("en-US") : new Date().toLocaleDateString("en-US")],
    ["Model", vendorList.modelUsed || ""],
  ];
  const infoWs = XLSX.utils.aoa_to_sheet(infoData);
  infoWs["!cols"] = [{ wch: 15 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, infoWs, "Info");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
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
    const doc = new PDFDocument({ size: "letter", margins: { top: 50, bottom: 10, left: 50, right: 50 }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const leftMargin = 50;
    const contentWidth = 512;
    const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#323F4F")
      .text(sanitize(projectName), leftMargin, 50, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(11).fillColor("#8496B0")
      .text(`Scenario: ${sanitize(scenarioName)}`, leftMargin, 80, { align: "center", width: contentWidth });
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#44546A")
      .text("Project Summary", leftMargin, 100, { align: "center", width: contentWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#8496B0")
      .text(`Type ${projectType}: ${typeLabels[projectType] || projectType}  |  Generated: ${new Date().toLocaleDateString("en-US")}`, leftMargin, 122, { align: "center", width: contentWidth });

    let y = 145;

    y = addSectionHeader(doc, "Project Overview", y, leftMargin, contentWidth);
    const execSummary = buildExecutiveSummary(projectName, projectType, upifData, mbResults, capexResults, opexResults, financialResults);
    doc.font("Helvetica").fontSize(9).fillColor("#44546A")
      .text(sanitize(execSummary), leftMargin, y, { width: contentWidth, lineGap: 3 });
    y += doc.heightOfString(sanitize(execSummary), { width: contentWidth, lineGap: 3 }) + 10;

    if (upifData?.feedstocks && Array.isArray(upifData.feedstocks) && upifData.feedstocks.length > 0) {
      y += 4;
      const fsHeaders = ["Feedstock Type", "Volume", "Unit"];
      const fsRows = upifData.feedstocks.map((fs: any) => [
        sanitize(fs.feedstockType || ""),
        fs.feedstockVolume ? Number(fs.feedstockVolume).toLocaleString("en-US") : "-",
        sanitize(fs.feedstockUnit || ""),
      ]);
      y = drawTable(doc, fsHeaders, fsRows, leftMargin, y, [220, 146, 146]);
      y += 15;
    } else {
      y += 10;
    }

    const metrics = financialResults.metrics || {} as any;
    y = addSectionHeader(doc, "Financial Returns (Key Metrics) — amounts in $000s", y, leftMargin, contentWidth);
    const metricsHeaders = ["Metric", "Value", "Metric", "Value"];
    const metricsRows = [
      [
        "IRR",
        metrics.irr !== null && metrics.irr !== undefined ? `${fmtNum(metrics.irr * 100)}%` : "N/A",
        "Total CapEx",
        fmtCurrencyK(metrics.totalCapex),
      ],
      [
        "NPV @ 10%",
        fmtCurrencyK(metrics.npv10),
        "ITC Proceeds",
        fmtCurrencyK(metrics.itcProceeds),
      ],
      [
        "MOIC",
        `${fmtNum(metrics.moic, 1)}x`,
        "Total 20-Year Revenue",
        fmtCurrencyK(metrics.totalRevenue),
      ],
      [
        "Payback Period",
        metrics.paybackYears !== null && metrics.paybackYears !== undefined ? `${fmtNum(metrics.paybackYears, 1)} years` : "N/A",
        "Avg Annual EBITDA",
        fmtCurrencyK(metrics.averageAnnualEbitda),
      ],
    ];
    y = drawTable(doc, metricsHeaders, metricsRows, leftMargin, y, [100, 156, 120, 136], { headerBg: "#00B050" });
    y += 15;

    if (y > 580) { doc.addPage(); y = 50; } else { y += 10; }

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
        doc.font("Helvetica-Oblique").fontSize(8).fillColor("#8496B0")
          .text("See Appendix for full list", leftMargin, y, { width: contentWidth });
        y += 14;
      }
      y += 10;
    }

    if (y > 680) { doc.addPage(); y = 50; }
    y = addSectionHeader(doc, "CapEx Summary ($000s)", y, leftMargin, contentWidth);
    const capSummary = capexResults.summary;
    const equipmentCost = capSummary.totalEquipmentCost || 0;
    const isDeterministic = capSummary.subtotalDirectCosts != null;
    const totalDirectCosts = isDeterministic
      ? (capSummary.subtotalDirectCosts || 0)
      : (capSummary.totalInstalledCost || 0);
    const installationCost = totalDirectCosts - equipmentCost;
    const engCost = capSummary.engineeringCost || 0;
    const contingencyAmt = isDeterministic
      ? (capSummary.contingency || capSummary.totalContingency || 0)
      : (capSummary.totalContingency || 0);
    const totalCapitalCosts = capSummary.totalProjectCost || 0;
    const otherIndirect = totalCapitalCosts - totalDirectCosts - engCost - contingencyAmt;
    const capexSumRows: string[][] = [
      ["Equipment", fmtCurrencyK(equipmentCost)],
      ["Installation", fmtCurrencyK(installationCost)],
      ["Total Direct Costs", fmtCurrencyK(totalDirectCosts)],
      [`Engineering (${capSummary.engineeringPct || 7}%)`, fmtCurrencyK(engCost)],
      ["Other Indirect Costs", fmtCurrencyK(otherIndirect > 0 ? otherIndirect : 0)],
      ["Contingency (7.5%)", fmtCurrencyK(contingencyAmt)],
      ["Total Capital Costs", fmtCurrencyK(totalCapitalCosts)],
    ];
    y = drawTable(doc, ["Item", "Amount"], capexSumRows, leftMargin, y, [300, 212], { headerBg: "#323F4F" });
    y += 15;

    if (y > 680) { doc.addPage(); y = 50; }
    y = addSectionHeader(doc, "OpEx Summary ($000s)", y, leftMargin, contentWidth);
    const opSummary = opexResults.summary;
    const opexSumRows: string[][] = [
      ["Total Annual OpEx", fmtCurrencyK(opSummary.totalAnnualOpex)],
      ["Labor", fmtCurrencyK(opSummary.totalLaborCost)],
      ["Energy", fmtCurrencyK(opSummary.totalEnergyCost)],
      ["Chemicals", fmtCurrencyK(opSummary.totalChemicalCost)],
      ["Maintenance", fmtCurrencyK(opSummary.totalMaintenanceCost)],
      ["Disposal", fmtCurrencyK(opSummary.totalDisposalCost)],
    ];
    y = drawTable(doc, ["Item", "Amount"], opexSumRows, leftMargin, y, [300, 212], { headerBg: "#323F4F" });
    y += 15;

    if (mode === "full") {
      doc.addPage();
      y = 50;
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#323F4F")
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
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#44546A")
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
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#323F4F")
        .text("Appendix B - CapEx Detail", leftMargin, y, { width: contentWidth });
      y += 25;

      if (capexResults.lineItems && capexResults.lineItems.length > 0) {
        y = addSectionHeader(doc, "CapEx Line Items ($000s)", y, leftMargin, contentWidth);
        const capHeaders = ["Description", "Qty", "Unit Cost", "Total Cost"];
        const capColWidths = [220, 42, 125, 125];
        const capTableWidth = capColWidths.reduce((a, b) => a + b, 0);
        const capFontSize = 7;
        const capCellPad = 3;
        const capMinRowH = 16;

        const drawCapRow = (cells: string[], bold: boolean, bgColor?: string, fontColor?: string) => {
          const rowH = Math.max(capMinRowH, ...cells.map((c, i) => {
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(capFontSize);
            return doc.heightOfString(sanitize(c || ""), { width: capColWidths[i] - capCellPad * 2 }) + capCellPad * 2;
          }));
          if (y + rowH > 732) {
            doc.addPage(); y = 50;
            drawCapRow(capHeaders, true, "#323F4F", "#FFFFFF");
          }
          if (bgColor) doc.rect(leftMargin, y, capTableWidth, rowH).fill(bgColor);
          let x = leftMargin;
          for (let i = 0; i < cells.length; i++) {
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(capFontSize)
              .fillColor(fontColor || "#44546A")
              .text(sanitize(cells[i] || ""), x + capCellPad, y + capCellPad, { width: capColWidths[i] - capCellPad * 2 });
            x += capColWidths[i];
          }
          doc.rect(leftMargin, y, capTableWidth, rowH).lineWidth(0.5).strokeColor("#CFD1D4").stroke();
          y += rowH;
        };

        drawCapRow(capHeaders, true, "#323F4F", "#FFFFFF");

        let lastProcess = "";
        let processTotal = 0;
        let grandTotal = 0;
        let rowIdx = 0;
        const capItems = capexResults.lineItems;
        for (let i = 0; i < capItems.length; i++) {
          const li = capItems[i];
          if (li.process !== lastProcess) {
            if (lastProcess && processTotal > 0) {
              drawCapRow([`${lastProcess} Subtotal`, "", "", fmtCurrencyK(processTotal)], true, "#D6DCE4");
            }
            lastProcess = li.process;
            processTotal = 0;
          }
          processTotal += li.totalCost;
          grandTotal += li.totalCost;
          drawCapRow([
            sanitize(li.equipmentType),
            String(li.quantity),
            fmtCurrencyK(li.baseCostPerUnit),
            fmtCurrencyK(li.totalCost),
          ], false, rowIdx % 2 === 1 ? "#E9E9EB" : undefined);
          rowIdx++;
        }
        if (lastProcess && processTotal > 0) {
          drawCapRow([`${lastProcess} Subtotal`, "", "", fmtCurrencyK(processTotal)], true, "#D6DCE4");
        }
        drawCapRow(["Total Capital Costs", "", "", fmtCurrencyK(capexResults.summary?.totalProjectCost || grandTotal)], true, "#2E7D32", "#FFFFFF");
        y += 15;
      }

      doc.addPage();
      y = 50;
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#323F4F")
        .text("Appendix C - OpEx Detail", leftMargin, y, { width: contentWidth });
      y += 25;

      if (opexResults.lineItems && opexResults.lineItems.length > 0) {
        y = addSectionHeader(doc, "OpEx Line Items ($000s)", y, leftMargin, contentWidth);
        const opHeaders = ["Description", "Unit Rate", "Annual Cost", "Notes"];
        const opColWidths = [175, 95, 80, 162];
        const opTableWidth = opColWidths.reduce((a, b) => a + b, 0);
        const opFontSize = 7;
        const opCellPad = 3;
        const opMinRowH = 16;

        const drawOpRow = (cells: string[], bold: boolean, bgColor?: string, fontColor?: string) => {
          const rowH = Math.max(opMinRowH, ...cells.map((c, i) => {
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(opFontSize);
            return doc.heightOfString(sanitize(c || ""), { width: opColWidths[i] - opCellPad * 2 }) + opCellPad * 2;
          }));
          if (y + rowH > 732) {
            doc.addPage(); y = 50;
            drawOpRow(opHeaders, true, "#323F4F", "#FFFFFF");
          }
          if (bgColor) doc.rect(leftMargin, y, opTableWidth, rowH).fill(bgColor);
          let x = leftMargin;
          for (let i = 0; i < cells.length; i++) {
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(opFontSize)
              .fillColor(fontColor || "#44546A")
              .text(sanitize(cells[i] || ""), x + opCellPad, y + opCellPad, { width: opColWidths[i] - opCellPad * 2 });
            x += opColWidths[i];
          }
          doc.rect(leftMargin, y, opTableWidth, rowH).lineWidth(0.5).strokeColor("#CFD1D4").stroke();
          y += rowH;
        };

        drawOpRow(opHeaders, true, "#323F4F", "#FFFFFF");

        let lastCategory = "";
        let catTotal = 0;
        let grandOpTotal = 0;
        let opRowIdx = 0;
        const opItems = opexResults.lineItems;
        for (let i = 0; i < opItems.length; i++) {
          const li = opItems[i];
          if (li.category !== lastCategory) {
            if (lastCategory && catTotal !== 0) {
              const catLabel = catTotal < 0 ? `${lastCategory} Subtotal (Credit)` : `${lastCategory} Subtotal`;
              drawOpRow([catLabel, "", fmtCurrencyK(catTotal), ""], true, "#D6DCE4");
            }
            lastCategory = li.category;
            catTotal = 0;
          }
          catTotal += li.annualCost;
          grandOpTotal += li.annualCost;
          const unitRateStr = li.unitCost != null && li.unitBasis
            ? `${li.unitCost < 1 ? `$${li.unitCost.toFixed(2)}` : fmtCurrency(li.unitCost)}/${li.unitBasis}`
            : li.scalingBasis || "";
          drawOpRow([
            sanitize(li.description),
            unitRateStr,
            fmtCurrencyK(li.annualCost),
            sanitize(li.notes || ""),
          ], false, opRowIdx % 2 === 1 ? "#E9E9EB" : undefined);
          opRowIdx++;
        }
        if (lastCategory && catTotal !== 0) {
          const catLabel = catTotal < 0 ? `${lastCategory} Subtotal (Credit)` : `${lastCategory} Subtotal`;
          drawOpRow([catLabel, "", fmtCurrencyK(catTotal), ""], true, "#D6DCE4");
        }
        drawOpRow(["Total Annual OpEx", "", fmtCurrencyK(opexResults.summary?.totalAnnualOpex || grandOpTotal), ""], true, "#2E7D32", "#FFFFFF");
        y += 15;
      }

      doc.addPage();
      y = 50;
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#323F4F")
        .text("Appendix D - Pro-Forma Financial Projections", leftMargin, y, { width: contentWidth });
      y += 25;

      const assumptions = financialResults.assumptions;
      const isVolMarket = assumptions.revenueMarket === "voluntary";
      y = addSectionHeader(doc, "Financial Assumptions", y, leftMargin, contentWidth);
      const assumpRows: string[][] = [
        ["Inflation Rate", `${fmtNum(assumptions.inflationRate * 100)}%`],
        ["Project Life", `${assumptions.projectLifeYears} years`],
        ["Construction Period", `${assumptions.constructionMonths} months`],
        ["Uptime", `${fmtNum(assumptions.uptimePct * 100)}%`],
        ["Revenue Market", isVolMarket ? "Voluntary" : "D3 RINs"],
      ];
      if (isVolMarket) {
        const vp = assumptions.voluntaryPricing;
        if (vp) {
          assumpRows.push(
            ["Gas Price", `${fmtCurrency(vp.gasPricePerMMBtu)}/MMBtu`],
            ["Gas Price Escalator", `${fmtNum(vp.gasPriceEscalator * 100)}%/yr`],
            ["Voluntary Premium", `${fmtCurrency(vp.voluntaryPremiumPerMMBtu)}/MMBtu`],
            ["Premium Escalator", `${fmtNum(vp.voluntaryPremiumEscalator * 100)}%/yr`],
          );
        }
      } else {
        assumpRows.push(
          ["RIN Price", `${fmtCurrency(assumptions.rinPricePerRIN)}/RIN`],
          ["RIN Brokerage", `${fmtNum(assumptions.rinBrokeragePct * 100)}%`],
          ["Natural Gas Price", `${fmtCurrency(assumptions.natGasPricePerMMBtu)}/MMBtu`],
        );
      }
      assumpRows.push(
        ["Wheel/Hub Cost", `${fmtCurrency(assumptions.wheelHubCostPerMMBtu)}/MMBtu`],
        ["Discount Rate", `${fmtNum(assumptions.discountRate * 100)}%`],
        ["ITC Rate", `${fmtNum(assumptions.itcRate * 100)}%`],
      );
      if (assumptions.fortyFiveZ) {
        assumpRows.push(["45Z Credits", assumptions.fortyFiveZ.enabled ? "Enabled" : "Disabled"]);
        if (assumptions.fortyFiveZ.enabled) {
          assumpRows.push(
            ["45Z CI Score", `${fmtNum(assumptions.fortyFiveZ.ciScore)} gCO₂e/MJ`],
            ["45Z Target CI", `${fmtNum(assumptions.fortyFiveZ.targetCI)} gCO₂e/MJ`],
            ["45Z Credit Price", `${fmtCurrency(assumptions.fortyFiveZ.creditPricePerGal)}/gal`],
            ["45Z Monetization", `${fmtNum(assumptions.fortyFiveZ.monetizationPct * 100)}%`],
            ["45Z End Year", String(assumptions.fortyFiveZ.endYear)],
          );
        }
      }
      y = drawTable(doc, ["Assumption", "Value"], assumpRows, leftMargin, y, [256, 256]);
      y += 15;

      if (financialResults.proForma && financialResults.proForma.length > 0) {
        if (y > 680) { doc.addPage(); y = 50; }
        const marketLabel = isVolMarket ? "Voluntary Market" : "D3 RIN Market";
        y = addSectionHeader(doc, `Pro-Forma Projections ($000) — ${marketLabel}`, y, leftMargin, contentWidth);
        const has45Z = financialResults.proForma.some(pf => (pf.fortyFiveZRevenue || 0) > 0);
        const pfHeaders: string[] = ["Year", "Cal Year", "RNG (MMBtu)"];
        if (has45Z) pfHeaders.push("45Z Rev");
        pfHeaders.push("Revenue", "OpEx", "EBITDA", "Net CF", "Cumul CF");

        const pfRows = financialResults.proForma.map(pf => {
          const base = [
            String(pf.year),
            String(pf.calendarYear),
            fmtNum(pf.rngProductionMMBtu, 0),
          ];
          if (has45Z) base.push(fmtNum((pf.fortyFiveZRevenue || 0) / 1000, 0));
          base.push(
            fmtNum(pf.totalRevenue / 1000, 0),
            fmtNum(pf.totalOpex / 1000, 0),
            fmtNum(pf.ebitda / 1000, 0),
            fmtNum(pf.netCashFlow / 1000, 0),
            fmtNum(pf.cumulativeCashFlow / 1000, 0),
          );
          return base;
        });
        const pfColWidths = has45Z
          ? [35, 50, 70, 55, 60, 55, 55, 60, 55]
          : [40, 55, 80, 72, 65, 65, 70, 65];
        y = drawTable(doc, pfHeaders, pfRows, leftMargin, y, pfColWidths, { fontSize: 7 });
      }
    }

    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(7).fillColor("#ADB9CA")
        .text("Confidential", leftMargin, 750, { width: contentWidth, align: "center", lineBreak: false });
      doc.font("Helvetica").fontSize(7).fillColor("#ADB9CA")
        .text(`Page ${i + 1}`, leftMargin, 760, { width: contentWidth, align: "center", lineBreak: false });
    }

    doc.end();
  });
}

export async function exportProjectSummaryExcel(
  projectName: string,
  scenarioName: string,
  projectType: string,
  upifData: any,
  mbResults: MassBalanceResults,
  capexResults: CapexResults,
  opexResults: OpexResults,
  financialResults: FinancialModelResults,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Project Factory — Burnham";
  wb.created = new Date();
  const typeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };
  const typeLabel = typeLabels[projectType] || projectType;

  const wsSummary = wb.addWorksheet("Project Summary", { properties: { tabColor: { argb: "FF323F4F" } } });
  let sr = 1;
  mbAddSectionTitle(wsSummary, sr, projectName, 4);
  sr++;
  const subRow = wsSummary.getRow(sr);
  subRow.getCell(1).value = `Scenario: ${scenarioName}`;
  subRow.getCell(1).font = { size: 11, color: { argb: "FF8496B0" } };
  subRow.getCell(3).value = `Type ${projectType}: ${typeLabel}`;
  subRow.getCell(3).font = { size: 10, color: { argb: "FF8496B0" } };
  wsSummary.mergeCells(sr, 1, sr, 2);
  wsSummary.mergeCells(sr, 3, sr, 4);
  sr++;
  const dateRow = wsSummary.getRow(sr);
  dateRow.getCell(1).value = `Generated: ${new Date().toLocaleDateString("en-US")}`;
  dateRow.getCell(1).font = { size: 9, color: { argb: "FF8496B0" } };
  wsSummary.mergeCells(sr, 1, sr, 4);
  sr++;
  sr++;

  const overview = buildExecutiveSummary(projectName, projectType, upifData, mbResults, capexResults, opexResults, financialResults);
  mbAddSubsectionTitle(wsSummary, sr, "Project Overview", 4);
  sr++;
  const overviewRow = wsSummary.getRow(sr);
  overviewRow.getCell(1).value = overview;
  overviewRow.getCell(1).font = { size: 9, color: { argb: "FF44546A" } };
  overviewRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
  wsSummary.mergeCells(sr, 1, sr, 4);
  overviewRow.height = 50;
  sr++;
  sr++;

  if (upifData?.feedstocks && Array.isArray(upifData.feedstocks) && upifData.feedstocks.length > 0) {
    mbAddSubsectionTitle(wsSummary, sr, "Feedstock Summary", 4);
    sr++;
    mbApplyTableHeaders(wsSummary, sr, ["Feedstock Type", "Volume", "Unit", ""], [25, 15, 15, 15]);
    sr++;
    upifData.feedstocks.forEach((fs: any, idx: number) => {
      mbAddDataRow(wsSummary, sr, [
        fs.feedstockType || "",
        fs.feedstockVolume ? Number(fs.feedstockVolume).toLocaleString("en-US") : "-",
        fs.feedstockUnit || "",
        "",
      ], idx % 2 === 1);
      sr++;
    });
    sr++;
  }

  const metrics = financialResults?.metrics || {} as any;
  mbAddSubsectionTitle(wsSummary, sr, "Key Financial Metrics ($000s)", 4);
  sr++;
  mbApplyTableHeaders(wsSummary, sr, ["Metric", "Value", "Metric", "Value"], [20, 15, 20, 15]);
  sr++;
  const metricPairs: [string, string, string, string][] = [
    ["IRR", metrics.irr !== null && metrics.irr !== undefined ? `${fmtNum(metrics.irr * 100)}%` : "N/A", "Total CapEx", fmtCurrencyK(metrics.totalCapex)],
    ["NPV @ 10%", fmtCurrencyK(metrics.npv10), "ITC Proceeds", fmtCurrencyK(metrics.itcProceeds)],
    ["MOIC", metrics.moic != null ? `${fmtNum(metrics.moic, 1)}x` : "N/A", "Total 20-Year Revenue", fmtCurrencyK(metrics.totalRevenue)],
    ["Payback Period", metrics.paybackYears != null ? `${fmtNum(metrics.paybackYears, 1)} years` : "N/A", "Avg Annual EBITDA", fmtCurrencyK(metrics.averageAnnualEbitda)],
  ];
  metricPairs.forEach((mp, idx) => {
    const r = wsSummary.getRow(sr);
    r.getCell(1).value = mp[0]; r.getCell(1).font = { bold: true, size: 10 }; r.getCell(1).border = MB_BORDER_THIN;
    r.getCell(2).value = mp[1]; r.getCell(2).border = MB_BORDER_THIN; r.getCell(2).alignment = { horizontal: "right" };
    r.getCell(3).value = mp[2]; r.getCell(3).font = { bold: true, size: 10 }; r.getCell(3).border = MB_BORDER_THIN;
    r.getCell(4).value = mp[3]; r.getCell(4).border = MB_BORDER_THIN; r.getCell(4).alignment = { horizontal: "right" };
    if (idx % 2 === 1) { for (let c = 1; c <= 4; c++) r.getCell(c).fill = MB_ALT_ROW_FILL; }
    r.height = 18;
    sr++;
  });
  sr++;

  const isDet = capexResults.summary?.subtotalDirectCosts != null;
  const eqCost = capexResults.summary?.totalEquipmentCost || 0;
  const tdCosts = isDet ? (capexResults.summary?.subtotalDirectCosts || 0) : (capexResults.summary?.totalInstalledCost || 0);
  const instCost = tdCosts - eqCost;
  const engC = capexResults.summary?.engineeringCost || 0;
  const contC = isDet ? (capexResults.summary?.contingency ?? capexResults.summary?.totalContingency ?? 0) : (capexResults.summary?.totalContingency || 0);
  const tcCost = capexResults.summary?.totalProjectCost || 0;
  const oiCost = Math.max(tcCost - tdCosts - engC - contC, 0);

  mbAddSubsectionTitle(wsSummary, sr, "CapEx Summary ($000s)", 4);
  sr++;
  mbApplyTableHeaders(wsSummary, sr, ["Item", "", "Amount", ""], [20, 15, 15, 15]);
  sr++;
  const capSumItems: [string, number][] = [
    ["Equipment", eqCost],
    ["Installation", instCost],
  ];
  capSumItems.forEach(([label, val], idx) => {
    const r = wsSummary.getRow(sr);
    r.getCell(1).value = label; r.getCell(1).font = { size: 10 }; r.getCell(1).border = MB_BORDER_THIN;
    wsSummary.mergeCells(sr, 1, sr, 2);
    r.getCell(3).value = fmtCurrencyK(val as number); r.getCell(3).border = MB_BORDER_THIN; r.getCell(3).alignment = { horizontal: "right" };
    wsSummary.mergeCells(sr, 3, sr, 4);
    if (idx % 2 === 1) { r.getCell(1).fill = MB_ALT_ROW_FILL; r.getCell(3).fill = MB_ALT_ROW_FILL; }
    r.height = 18;
    sr++;
  });
  cxAddSubtotalRow(wsSummary, sr, "Total Direct Costs", tdCosts, 4, CX_SUBTOTAL_FILL, CX_SUBTOTAL_FONT); sr++;
  const indirectItems: [string, string][] = [
    [`Engineering (${capexResults.summary?.engineeringPct || 7}%)`, fmtCurrencyK(engC)],
    ["Other Indirect Costs", fmtCurrencyK(oiCost)],
    ["Contingency (7.5%)", fmtCurrencyK(contC)],
  ];
  indirectItems.forEach(([label, val], idx) => {
    const r = wsSummary.getRow(sr);
    r.getCell(1).value = label; r.getCell(1).font = { size: 10 }; r.getCell(1).border = MB_BORDER_THIN;
    wsSummary.mergeCells(sr, 1, sr, 2);
    r.getCell(3).value = val; r.getCell(3).border = MB_BORDER_THIN; r.getCell(3).alignment = { horizontal: "right" };
    wsSummary.mergeCells(sr, 3, sr, 4);
    if (idx % 2 === 1) { r.getCell(1).fill = MB_ALT_ROW_FILL; r.getCell(3).fill = MB_ALT_ROW_FILL; }
    r.height = 18;
    sr++;
  });
  cxAddSubtotalRow(wsSummary, sr, "Total Capital Costs", tcCost, 4, CX_TOTAL_FILL, CX_TOTAL_FONT); sr++;
  sr++;

  const opSummary = opexResults.summary;
  if (opSummary) {
    mbAddSubsectionTitle(wsSummary, sr, "OpEx Summary ($000s)", 4);
    sr++;
    mbApplyTableHeaders(wsSummary, sr, ["Item", "", "Amount", ""], [20, 15, 15, 15]);
    sr++;
    const opSumItems: [string, number][] = [
      ["Labor", opSummary.totalLaborCost],
      ["Energy", opSummary.totalEnergyCost],
      ["Chemicals", opSummary.totalChemicalCost],
      ["Maintenance", opSummary.totalMaintenanceCost],
      ["Disposal", opSummary.totalDisposalCost],
      ["Other", opSummary.totalOtherCost],
    ];
    opSumItems.forEach(([label, val], idx) => {
      const r = wsSummary.getRow(sr);
      r.getCell(1).value = label; r.getCell(1).font = { size: 10 }; r.getCell(1).border = MB_BORDER_THIN;
      wsSummary.mergeCells(sr, 1, sr, 2);
      r.getCell(3).value = fmtCurrencyK(val); r.getCell(3).border = MB_BORDER_THIN; r.getCell(3).alignment = { horizontal: "right" };
      wsSummary.mergeCells(sr, 3, sr, 4);
      if (idx % 2 === 1) { r.getCell(1).fill = MB_ALT_ROW_FILL; r.getCell(3).fill = MB_ALT_ROW_FILL; }
      r.height = 18;
      sr++;
    });
    cxAddSubtotalRow(wsSummary, sr, "Total Annual OpEx", opSummary.totalAnnualOpex, 4, CX_TOTAL_FILL, CX_TOTAL_FONT); sr++;
  }
  wsSummary.getColumn(1).width = 20;
  wsSummary.getColumn(2).width = 15;
  wsSummary.getColumn(3).width = 20;
  wsSummary.getColumn(4).width = 15;

  if (upifData) {
    const wsUpif = wb.addWorksheet("UPIF", { properties: { tabColor: { argb: "FF44546A" } } });
    let ur = 1;
    mbAddSectionTitle(wsUpif, ur, "Unified Project Intake Form", 4);
    ur++;
    const upifInfo: [string, string][] = [
      ["Project", projectName],
      ["Scenario", scenarioName],
      ["Project Type", `${projectType} - ${typeLabel}`],
    ];
    if (upifData.location) upifInfo.push(["Location", cleanDoubleDashes(upifData.location)]);
    if (upifData.projectDescription) upifInfo.push(["Description", cleanDoubleDashes(upifData.projectDescription)]);
    mbApplyTableHeaders(wsUpif, ur, ["Field", "", "Value", ""], [20, 10, 25, 20]);
    ur++;
    upifInfo.forEach((row, idx) => {
      const r = wsUpif.getRow(ur);
      r.getCell(1).value = row[0]; r.getCell(1).font = { bold: true, size: 10 }; r.getCell(1).border = MB_BORDER_THIN;
      wsUpif.mergeCells(ur, 1, ur, 2);
      r.getCell(3).value = row[1]; r.getCell(3).border = MB_BORDER_THIN; r.getCell(3).alignment = { wrapText: true };
      wsUpif.mergeCells(ur, 3, ur, 4);
      if (idx % 2 === 1) { r.getCell(1).fill = MB_ALT_ROW_FILL; r.getCell(3).fill = MB_ALT_ROW_FILL; }
      r.height = 18;
      ur++;
    });
    ur++;

    if (upifData.feedstocks && Array.isArray(upifData.feedstocks)) {
      for (let fi = 0; fi < upifData.feedstocks.length; fi++) {
        const fs = upifData.feedstocks[fi];
        const fsLabel = upifData.feedstocks.length > 1 ? `Feedstock ${fi + 1}: ${fs.feedstockType || "Unknown"}` : `Feedstock: ${fs.feedstockType || "Unknown"}`;
        mbAddSubsectionTitle(wsUpif, ur, fsLabel, 4);
        ur++;
        if (fs.feedstockVolume) {
          const r = wsUpif.getRow(ur);
          r.getCell(1).value = "Volume"; r.getCell(1).font = { bold: true, size: 10 }; r.getCell(1).border = MB_BORDER_THIN;
          wsUpif.mergeCells(ur, 1, ur, 2);
          r.getCell(3).value = `${Number(fs.feedstockVolume).toLocaleString("en-US")} ${fs.feedstockUnit || ""}`.trim();
          r.getCell(3).border = MB_BORDER_THIN;
          wsUpif.mergeCells(ur, 3, ur, 4);
          r.height = 18;
          ur++;
        }
        if (fs.feedstockSpecs && Object.keys(fs.feedstockSpecs).length > 0) {
          mbApplyTableHeaders(wsUpif, ur, ["Parameter", "Value", "Unit", "Source"], [20, 15, 12, 20]);
          ur++;
          Object.entries(fs.feedstockSpecs).sort((a: any, b: any) => (a[1].sortOrder || 0) - (b[1].sortOrder || 0)).forEach(([key, spec]: [string, any], idx) => {
            mbAddDataRow(wsUpif, ur, [
              spec.label || camelToTitle(key),
              mbFormatValue(spec.value),
              spec.unit || "",
              spec.source || "",
            ], idx % 2 === 1);
            ur++;
          });
        }
        ur++;
      }
    }

    if (upifData.outputRequirements && Object.keys(upifData.outputRequirements).length > 0) {
      mbAddSubsectionTitle(wsUpif, ur, "Output Requirements", 4);
      ur++;
      mbApplyTableHeaders(wsUpif, ur, ["Parameter", "Value", "Unit", "Source"], [20, 15, 12, 20]);
      ur++;
      Object.entries(upifData.outputRequirements).forEach(([key, spec]: [string, any], idx) => {
        mbAddDataRow(wsUpif, ur, [
          spec.label || camelToTitle(key),
          mbFormatValue(spec.value),
          spec.unit || "",
          spec.source || "",
        ], idx % 2 === 1);
        ur++;
      });
      ur++;
    }

    if (upifData.unmappedSpecs && Array.isArray(upifData.unmappedSpecs) && upifData.unmappedSpecs.length > 0) {
      mbAddSubsectionTitle(wsUpif, ur, "Additional Specifications", 4);
      ur++;
      mbApplyTableHeaders(wsUpif, ur, ["Specification", "Value", "", ""], [25, 20, 15, 15]);
      ur++;
      upifData.unmappedSpecs.forEach((spec: any, idx: number) => {
        mbAddDataRow(wsUpif, ur, [spec.text || spec, "", "", ""], idx % 2 === 1);
        ur++;
      });
    }
  }

  if (mbResults) {
    const wsMB = wb.addWorksheet("Mass Balance", { properties: { tabColor: { argb: "FF00B050" } } });
    let mr = 1;
    mbAddSectionTitle(wsMB, mr, `Mass Balance — ${projectName}`, 6);
    mr++;

    if (mbResults.summary && Object.keys(mbResults.summary).length > 0) {
      mbAddSubsectionTitle(wsMB, mr, "Summary", 6);
      mr++;
      mbApplyTableHeaders(wsMB, mr, ["Parameter", "Value", "Unit", "", "", ""], [25, 18, 15, 10, 10, 10]);
      mr++;
      Object.entries(mbResults.summary).forEach(([key, val], idx) => {
        const v = val as any;
        mbAddDataRow(wsMB, mr, [
          camelToTitle(key),
          v?.value ?? "-",
          v?.unit ?? "",
          "", "", "",
        ], idx % 2 === 1);
        mr++;
      });
      mr++;
    }

    if (mbResults.equipment && mbResults.equipment.length > 0) {
      mbAddSubsectionTitle(wsMB, mr, "Equipment List", 6);
      mr++;
      mbApplyTableHeaders(wsMB, mr, ["Process", "Equipment", "Qty", "Description", "Design Basis", "Notes"], [18, 22, 6, 30, 25, 20]);
      mr++;
      mbResults.equipment.forEach((eq, idx) => {
        mbAddDataRow(wsMB, mr, [eq.process, eq.equipmentType, eq.quantity, eq.description, eq.designBasis, eq.notes?.join("; ") || ""], idx % 2 === 1);
        mr++;
      });
      mr++;
    }

    if (mbResults.adStages && mbResults.adStages.length > 0) {
      mbAddSubsectionTitle(wsMB, mr, "Process Stages", 6);
      mr++;
      for (const stage of mbResults.adStages) {
        const stageRow = wsMB.getRow(mr);
        stageRow.getCell(1).value = `${stage.name} (${stage.type})`;
        stageRow.getCell(1).font = { bold: true, size: 10, color: { argb: "FF323F4F" } };
        stageRow.getCell(1).border = MB_BORDER_THIN;
        wsMB.mergeCells(mr, 1, mr, 6);
        stageRow.height = 20;
        mr++;
        mbApplyTableHeaders(wsMB, mr, ["Parameter", "Input Value", "Input Unit", "Output Value", "Output Unit", ""], [20, 15, 12, 15, 12, 10]);
        mr++;
        const allKeys = new Set([...Object.keys(stage.inputStream || {}), ...Object.keys(stage.outputStream || {})]);
        Array.from(allKeys).forEach((key, idx) => {
          const inp = (stage.inputStream as any)?.[key];
          const out = (stage.outputStream as any)?.[key];
          mbAddDataRow(wsMB, mr, [
            camelToTitle(key),
            inp ? mbFormatValue(inp.value) : "-",
            inp?.unit || "",
            out ? mbFormatValue(out.value) : "-",
            out?.unit || "",
            "",
          ], idx % 2 === 1);
          mr++;
        });
        mr++;
      }
    }

    if (mbResults.calculationSteps && mbResults.calculationSteps.length > 0) {
      mbAddSubsectionTitle(wsMB, mr, "Calculation Steps", 6);
      mr++;
      mbApplyTableHeaders(wsMB, mr, ["Category", "Step", "Formula", "Inputs", "Result", "Notes"], [15, 18, 25, 25, 18, 18]);
      mr++;
      mbResults.calculationSteps.forEach((step, idx) => {
        const inputsStr = step.inputs.map(inp => `${inp.name}=${inp.value} ${inp.unit}`).join("; ");
        mbAddDataRow(wsMB, mr, [
          step.category,
          step.label,
          step.formula,
          inputsStr,
          `${step.result.value} ${step.result.unit}`,
          step.notes || "",
        ], idx % 2 === 1);
        mr++;
      });
    }
  }

  if (capexResults && capexResults.lineItems) {
    const wsCap = wb.addWorksheet("CapEx", { properties: { tabColor: { argb: "FF4472C4" } } });
    let cr = 1;
    cxAddSectionRow(wsCap, cr, "Capital Cost Estimate", 5);
    cr++;
    cxApplyHeaders(wsCap, cr, ["Description", "Qty", "Unit Cost ($)", "Total Cost ($)", "Source"], [30, 8, 18, 18, 25]);
    cr++;

    let lastProcess = "";
    let processTotal = 0;
    let rowIdx = 0;
    const capItems = capexResults.lineItems;
    for (let i = 0; i < capItems.length; i++) {
      const li = capItems[i];
      if (li.process !== lastProcess) {
        if (lastProcess && processTotal > 0) {
          cxAddSubtotalRow(wsCap, cr, `${lastProcess} Subtotal`, processTotal, 5, CX_SUBTOTAL_FILL, CX_SUBTOTAL_FONT);
          cr++;
        }
        lastProcess = li.process;
        processTotal = 0;
        const procRow = wsCap.getRow(cr);
        procRow.getCell(1).value = li.process;
        procRow.getCell(1).fill = MB_SUBSECTION_FILL;
        procRow.getCell(1).font = MB_SUBSECTION_FONT;
        for (let c = 2; c <= 5; c++) { procRow.getCell(c).fill = MB_SUBSECTION_FILL; procRow.getCell(c).border = MB_BORDER_THIN; }
        wsCap.mergeCells(cr, 1, cr, 5);
        procRow.height = 22;
        cr++;
      }
      processTotal += li.totalCost;
      cxAddDataRow(wsCap, cr, [
        li.equipmentType,
        li.quantity,
        li.baseCostPerUnit,
        li.totalCost,
        li.source,
      ], rowIdx % 2 === 1, [2, 3]);
      cr++;
      rowIdx++;
    }
    if (lastProcess && processTotal > 0) {
      cxAddSubtotalRow(wsCap, cr, `${lastProcess} Subtotal`, processTotal, 5, CX_SUBTOTAL_FILL, CX_SUBTOTAL_FONT);
      cr++;
    }
    cxAddSubtotalRow(wsCap, cr, "Total Capital Costs", capexResults.summary?.totalProjectCost || 0, 5, CX_TOTAL_FILL, CX_TOTAL_FONT);
    cr++;

    if (capexResults.assumptions && capexResults.assumptions.length > 0) {
      cr++;
      mbAddSubsectionTitle(wsCap, cr, "Cost Assumptions", 5);
      cr++;
      mbApplyTableHeaders(wsCap, cr, ["Parameter", "Value", "Source", "", ""], [25, 25, 25, 10, 10]);
      cr++;
      capexResults.assumptions.forEach((a, idx) => {
        mbAddDataRow(wsCap, cr, [a.parameter, a.value, a.source, "", ""], idx % 2 === 1);
        cr++;
      });
    }
  }

  if (opexResults && opexResults.lineItems) {
    const wsOp = wb.addWorksheet("OpEx", { properties: { tabColor: { argb: "FF00B050" } } });
    let or2 = 1;
    cxAddSectionRow(wsOp, or2, "Annual Operating Cost Estimate", 6);
    or2++;
    cxApplyHeaders(wsOp, or2, ["Description", "Unit Rate", "Annual Cost ($)", "Scaling Basis", "Source", "Notes"], [30, 18, 16, 18, 18, 22]);
    or2++;

    let lastCat = "";
    let catTotal = 0;
    let opRowIdx = 0;
    const opItems = opexResults.lineItems;
    for (let i = 0; i < opItems.length; i++) {
      const li = opItems[i];
      if (li.category !== lastCat) {
        if (lastCat && catTotal !== 0) {
          const catLabel = catTotal < 0 ? `${lastCat} Subtotal (Credit)` : `${lastCat} Subtotal`;
          cxAddSubtotalRow(wsOp, or2, catLabel, catTotal, 6, CX_SUBTOTAL_FILL, CX_SUBTOTAL_FONT);
          or2++;
        }
        lastCat = li.category;
        catTotal = 0;
        const catRow = wsOp.getRow(or2);
        catRow.getCell(1).value = li.category;
        catRow.getCell(1).fill = MB_SUBSECTION_FILL;
        catRow.getCell(1).font = MB_SUBSECTION_FONT;
        for (let c = 2; c <= 6; c++) { catRow.getCell(c).fill = MB_SUBSECTION_FILL; catRow.getCell(c).border = MB_BORDER_THIN; }
        wsOp.mergeCells(or2, 1, or2, 6);
        catRow.height = 22;
        or2++;
      }
      catTotal += li.annualCost;
      const unitRateStr = li.unitCost != null && li.unitBasis
        ? `${li.unitCost < 1 ? `$${li.unitCost.toFixed(2)}` : `$${li.unitCost.toLocaleString("en-US")}`}/${li.unitBasis}`
        : "";
      cxAddDataRow(wsOp, or2, [
        li.description,
        unitRateStr,
        li.annualCost,
        li.scalingBasis || li.costBasis || "",
        li.source,
        li.notes || "",
      ], opRowIdx % 2 === 1, [2]);
      or2++;
      opRowIdx++;
    }
    if (lastCat && catTotal !== 0) {
      const catLabel = catTotal < 0 ? `${lastCat} Subtotal (Credit)` : `${lastCat} Subtotal`;
      cxAddSubtotalRow(wsOp, or2, catLabel, catTotal, 6, CX_SUBTOTAL_FILL, CX_SUBTOTAL_FONT);
      or2++;
    }
    cxAddSubtotalRow(wsOp, or2, "Total Annual OpEx", opexResults.summary?.totalAnnualOpex || 0, 6, CX_TOTAL_FILL, CX_TOTAL_FONT);
    or2++;

    if (opexResults.assumptions && opexResults.assumptions.length > 0) {
      or2++;
      mbAddSubsectionTitle(wsOp, or2, "OpEx Assumptions", 6);
      or2++;
      mbApplyTableHeaders(wsOp, or2, ["Parameter", "Value", "Source", "", "", ""], [25, 18, 25, 10, 10, 10]);
      or2++;
      opexResults.assumptions.forEach((a, idx) => {
        mbAddDataRow(wsOp, or2, [a.parameter, a.value, a.source, "", "", ""], idx % 2 === 1);
        or2++;
      });
    }
  }

  if (financialResults && financialResults.proForma) {
    const wsFin = wb.addWorksheet("Financial Model", { properties: { tabColor: { argb: "FF2E7D32" } } });
    let fr = 1;
    const assumptions = financialResults.assumptions;
    const isVol = assumptions?.revenueMarket === "voluntary";
    const marketLabel = isVol ? "Voluntary Market" : "D3 RIN Market";

    mbAddSectionTitle(wsFin, fr, `Pro-Forma Financial Projections — ${marketLabel}`, 10);
    fr++;

    mbAddSubsectionTitle(wsFin, fr, "Assumptions", 10);
    fr++;
    mbApplyTableHeaders(wsFin, fr, ["Assumption", "Value", "", "", "", "", "", "", "", ""], [25, 20, 10, 10, 10, 10, 10, 10, 10, 10]);
    fr++;
    const assRows: [string, string][] = [];
    if (assumptions) {
      assRows.push(
        ["Inflation Rate", `${fmtNum(assumptions.inflationRate * 100)}%`],
        ["Project Life", `${assumptions.projectLifeYears} years`],
        ["Construction Period", `${assumptions.constructionMonths} months`],
        ["Uptime", `${fmtNum(assumptions.uptimePct * 100)}%`],
        ["Revenue Market", isVol ? "Voluntary" : "D3 RINs"],
      );
      if (isVol && assumptions.voluntaryPricing) {
        const vp = assumptions.voluntaryPricing;
        assRows.push(
          ["Gas Price", `$${vp.gasPricePerMMBtu}/MMBtu`],
          ["Gas Price Escalator", `${fmtNum(vp.gasPriceEscalator * 100)}%/yr`],
          ["Voluntary Premium", `$${vp.voluntaryPremiumPerMMBtu}/MMBtu`],
          ["Premium Escalator", `${fmtNum(vp.voluntaryPremiumEscalator * 100)}%/yr`],
        );
      } else {
        assRows.push(
          ["RIN Price", `$${assumptions.rinPricePerRIN}/RIN`],
          ["RIN Brokerage", `${fmtNum(assumptions.rinBrokeragePct * 100)}%`],
          ["Natural Gas Price", `$${assumptions.natGasPricePerMMBtu}/MMBtu`],
        );
      }
      assRows.push(
        ["Wheel/Hub Cost", `$${assumptions.wheelHubCostPerMMBtu}/MMBtu`],
        ["Discount Rate", `${fmtNum(assumptions.discountRate * 100)}%`],
        ["ITC Rate", `${fmtNum(assumptions.itcRate * 100)}%`],
      );
      if (assumptions.fortyFiveZ) {
        assRows.push(["45Z Credits", assumptions.fortyFiveZ.enabled ? "Enabled" : "Disabled"]);
        if (assumptions.fortyFiveZ.enabled) {
          assRows.push(
            ["45Z CI Score", `${fmtNum(assumptions.fortyFiveZ.ciScore)} gCO₂e/MJ`],
            ["45Z Credit Price", `$${assumptions.fortyFiveZ.creditPricePerGal}/gal`],
            ["45Z End Year", String(assumptions.fortyFiveZ.endYear)],
          );
        }
      }
    }
    assRows.forEach(([label, val], idx) => {
      const r = wsFin.getRow(fr);
      r.getCell(1).value = label; r.getCell(1).font = { bold: true, size: 10 }; r.getCell(1).border = MB_BORDER_THIN;
      r.getCell(2).value = val; r.getCell(2).border = MB_BORDER_THIN;
      if (idx % 2 === 1) { r.getCell(1).fill = MB_ALT_ROW_FILL; r.getCell(2).fill = MB_ALT_ROW_FILL; }
      r.height = 18;
      fr++;
    });
    fr++;

    const has45Z = financialResults.proForma.some(pf => (pf.fortyFiveZRevenue || 0) > 0);
    const pfHeaders = ["Year", "Cal Year", "RNG (MMBtu)"];
    if (has45Z) pfHeaders.push("45Z Revenue");
    pfHeaders.push("Tipping Fees", "Total Revenue", "Total OpEx", "EBITDA", "Net Cash Flow", "Cumulative CF");
    const pfWidths = has45Z ? [8, 10, 16, 14, 14, 14, 14, 14, 14, 14] : [8, 10, 16, 14, 14, 14, 14, 14, 14];

    mbAddSubsectionTitle(wsFin, fr, "Pro-Forma Projections ($000s)", pfHeaders.length);
    fr++;
    mbApplyTableHeaders(wsFin, fr, pfHeaders, pfWidths);
    fr++;

    financialResults.proForma.forEach((pf, idx) => {
      const vals: (string | number)[] = [
        pf.year,
        pf.calendarYear,
        Math.round(pf.rngProductionMMBtu),
      ];
      if (has45Z) vals.push(Math.round((pf.fortyFiveZRevenue || 0) / 1000));
      vals.push(
        Math.round((pf.tippingFeeRevenue || 0) / 1000),
        Math.round(pf.totalRevenue / 1000),
        Math.round(pf.totalOpex / 1000),
        Math.round(pf.ebitda / 1000),
        Math.round(pf.netCashFlow / 1000),
        Math.round(pf.cumulativeCashFlow / 1000),
      );
      const r = wsFin.getRow(fr);
      vals.forEach((v, ci) => {
        const cell = r.getCell(ci + 1);
        cell.value = v;
        cell.border = MB_BORDER_THIN;
        cell.alignment = { horizontal: ci <= 1 ? "center" : "right", vertical: "middle" };
        cell.font = { size: 10 };
        if (ci >= 2) cell.numFmt = "#,##0";
        if (idx % 2 === 1) cell.fill = MB_ALT_ROW_FILL;
      });
      r.height = 18;
      fr++;
    });

    fr++;
    mbAddSubsectionTitle(wsFin, fr, "Key Metrics", pfHeaders.length);
    fr++;
    const metricsList: [string, string][] = [
      ["IRR", metrics.irr !== null && metrics.irr !== undefined ? `${fmtNum(metrics.irr * 100)}%` : "N/A"],
      ["NPV @ 10%", fmtCurrencyK(metrics.npv10)],
      ["MOIC", metrics.moic != null ? `${fmtNum(metrics.moic, 1)}x` : "N/A"],
      ["Payback Period", metrics.paybackYears != null ? `${fmtNum(metrics.paybackYears, 1)} years` : "N/A"],
      ["Total CapEx", fmtCurrencyK(metrics.totalCapex)],
      ["Total 20-Year Revenue", fmtCurrencyK(metrics.totalRevenue)],
      ["Avg Annual EBITDA", fmtCurrencyK(metrics.averageAnnualEbitda)],
    ];
    metricsList.forEach(([label, val], idx) => {
      const r = wsFin.getRow(fr);
      r.getCell(1).value = label; r.getCell(1).font = { bold: true, size: 10 }; r.getCell(1).border = MB_BORDER_THIN;
      r.getCell(2).value = val; r.getCell(2).border = MB_BORDER_THIN; r.getCell(2).alignment = { horizontal: "right" };
      if (idx % 2 === 1) { r.getCell(1).fill = MB_ALT_ROW_FILL; r.getCell(2).fill = MB_ALT_ROW_FILL; }
      r.height = 18;
      fr++;
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
