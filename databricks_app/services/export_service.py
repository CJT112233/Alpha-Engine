import io
import re
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

TYPE_LABELS = {
    "A": "Wastewater Treatment",
    "B": "RNG Greenfield",
    "C": "RNG Bolt-On",
    "D": "Hybrid",
}


def _sanitize(text) -> str:
    if not text:
        return ""
    s = str(text)
    s = s.replace("\u2018", "'").replace("\u2019", "'").replace("\u201a", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u201e", '"')
    s = s.replace("\u2026", "...").replace("\u2013", "-").replace("\u2014", "--")
    s = s.replace("\u00a0", " ")
    return s


def _fmt_num(val, decimals=1) -> str:
    if val is None:
        return "-"
    try:
        v = float(val)
        return f"{v:,.{decimals}f}"
    except (ValueError, TypeError):
        return str(val)


def _fmt_currency(val) -> str:
    try:
        v = float(val)
        return f"${v:,.0f}"
    except (ValueError, TypeError):
        return str(val)


def _camel_to_title(s: str) -> str:
    result = re.sub(r"([A-Z])", r" \1", s)
    return result.strip().title()


def _wrap_text(text: str, max_width: float, font_name: str, font_size: int) -> list:
    from reportlab.pdfbase.pdfmetrics import stringWidth
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        if stringWidth(test, font_name, font_size) <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines if lines else [""]


def _draw_table(c, headers, rows, x, y, col_widths,
                font_size=8, header_bg="#2563EB", page_height=792, page_width=612):
    from reportlab.lib.colors import HexColor
    min_row_h = 16
    pad = 3
    table_w = sum(col_widths)

    def measure_h(cells, bold):
        from reportlab.pdfbase.pdfmetrics import stringWidth
        max_h = min_row_h
        for i, cell in enumerate(cells):
            cw = col_widths[i] - pad * 2
            fn = "Helvetica-Bold" if bold else "Helvetica"
            words = _sanitize(cell or "").split()
            lines = 1
            current = ""
            for w in words:
                test = f"{current} {w}".strip()
                if stringWidth(test, fn, font_size) > cw:
                    lines += 1
                    current = w
                else:
                    current = test
            h = (lines * (font_size + 2)) + pad * 2
            if h > max_h:
                max_h = h
        return max_h

    def draw_row(cells, bold, bg=None):
        nonlocal y
        rh = measure_h(cells, bold)
        if y - rh < 60:
            c.showPage()
            y = page_height - 50
            draw_row(headers, True, header_bg)
            return
        if bg:
            c.setFillColor(HexColor(bg))
            c.rect(x, y - rh, table_w, rh, fill=1, stroke=0)
        cx = x
        for i, cell in enumerate(cells):
            fn = "Helvetica-Bold" if bold else "Helvetica"
            fc = "#FFFFFF" if bg == header_bg else "#333333"
            c.setFont(fn, font_size)
            c.setFillColor(HexColor(fc))
            text = _sanitize(cell or "")
            cw = col_widths[i] - pad * 2
            wrapped = _wrap_text(text, cw, fn, font_size)
            ty = y - pad - font_size
            for line in wrapped:
                if ty < y - rh + pad:
                    break
                c.drawString(cx + pad, ty, line)
                ty -= (font_size + 2)
            cx += col_widths[i]
        c.setStrokeColor(HexColor("#CCCCCC"))
        c.setLineWidth(0.5)
        c.rect(x, y - rh, table_w, rh, fill=0, stroke=1)
        y -= rh

    draw_row(headers, True, header_bg)
    for idx, row in enumerate(rows):
        safe_row = [str(cell) if cell is not None else "-" for cell in row]
        bg = "#F8F9FA" if idx % 2 == 1 else None
        draw_row(safe_row, False, bg)
    return y


def _add_section_header(c, title, y, left_margin, content_width, page_height=792):
    from reportlab.lib.colors import HexColor
    if y < 100:
        c.showPage()
        y = page_height - 50
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(HexColor("#1E3A5F"))
    c.drawString(left_margin, y, title)
    y -= 20
    c.setStrokeColor(HexColor("#CCCCCC"))
    c.setLineWidth(0.5)
    c.line(left_margin, y, left_margin + content_width, y)
    y -= 8
    return y


def export_mass_balance_pdf(results: dict, scenario_name: str, project_name: str, project_type: str) -> bytes:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import HexColor

    page_width, page_height = LETTER
    left_margin = 50
    content_width = page_width - 100

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)

    c.setFont("Helvetica-Bold", 18)
    c.setFillColor(HexColor("#1E3A5F"))
    c.drawCentredString(page_width / 2, page_height - 50, "Mass Balance Report")

    c.setFont("Helvetica", 10)
    c.setFillColor(HexColor("#666666"))
    c.drawCentredString(page_width / 2, page_height - 75, f"Project: {_sanitize(project_name)}")
    c.drawCentredString(page_width / 2, page_height - 88, f"Scenario: {_sanitize(scenario_name)}")
    c.drawCentredString(page_width / 2, page_height - 101, f"Type {project_type}: {TYPE_LABELS.get(project_type, project_type)}")
    c.drawCentredString(page_width / 2, page_height - 114, f"Generated: {datetime.now().strftime('%m/%d/%Y')}")

    y = page_height - 140

    summary = results.get("summary") or {}
    if isinstance(summary, dict) and len(summary) > 0:
        y = _add_section_header(c, "Summary", y, left_margin, content_width, page_height)
        headers = ["Parameter", "Value", "Unit"]
        rows = []
        for key, val in summary.items():
            if isinstance(val, dict):
                rows.append([_camel_to_title(key), str(val.get("value", "-")), str(val.get("unit", ""))])
            else:
                rows.append([_camel_to_title(key), str(val), ""])
        y = _draw_table(c, headers, rows, left_margin, y, [200, 162, 150], page_height=page_height, page_width=page_width)
        y -= 15

    stages = results.get("stages") or []
    if isinstance(stages, list) and len(stages) > 0:
        y = _add_section_header(c, "Treatment Train - Stream Data", y, left_margin, content_width, page_height)
        conv = results.get("convergenceAchieved")
        if conv is not None:
            c.setFont("Helvetica", 8)
            c.setFillColor(HexColor("#666666"))
            c.drawString(left_margin, y, f"Convergence: {'Yes' if conv else 'No'} ({results.get('convergenceIterations', 0)} iterations)")
            y -= 14

        param_labels = {
            "flow": "Flow (GPD)", "bod": "BOD (mg/L)", "cod": "COD (mg/L)",
            "tss": "TSS (mg/L)", "tkn": "TKN (mg/L)", "tp": "TP (mg/L)", "fog": "FOG (mg/L)",
        }
        params = ["flow", "bod", "cod", "tss", "tkn", "tp", "fog"]

        for stage in stages:
            if y < 120:
                c.showPage()
                y = page_height - 50
            c.setFont("Helvetica-Bold", 9)
            c.setFillColor(HexColor("#333333"))
            c.drawString(left_margin, y, f"{_sanitize(stage.get('name', ''))} ({_sanitize(stage.get('type', ''))})")
            y -= 14

            s_headers = ["Parameter", "Influent", "Effluent", "Removal %"]
            influent = stage.get("influent") or {}
            effluent = stage.get("effluent") or {}
            removals = stage.get("removalEfficiencies") or {}
            s_rows = []
            for p in params:
                s_rows.append([
                    param_labels.get(p, p.upper()),
                    _fmt_num(influent.get(p)),
                    _fmt_num(effluent.get(p)),
                    f"{_fmt_num(removals.get(p))}%" if removals.get(p) is not None else "-",
                ])
            y = _draw_table(c, s_headers, s_rows, left_margin, y, [128, 128, 128, 128], page_height=page_height, page_width=page_width)
            y -= 10

    ad_stages = results.get("adStages") or []
    if isinstance(ad_stages, list) and len(ad_stages) > 0:
        y = _add_section_header(c, "AD / RNG Process Stages", y, left_margin, content_width, page_height)
        for stage in ad_stages:
            if y < 120:
                c.showPage()
                y = page_height - 50
            c.setFont("Helvetica-Bold", 9)
            c.setFillColor(HexColor("#333333"))
            c.drawString(left_margin, y, f"{_sanitize(stage.get('name', ''))} ({_sanitize(stage.get('type', ''))})")
            y -= 14

            input_stream = stage.get("inputStream") or {}
            output_stream = stage.get("outputStream") or {}
            all_keys = list(dict.fromkeys(list(input_stream.keys()) + list(output_stream.keys())))

            ad_headers = ["Parameter", "Input", "Output"]
            ad_rows = []
            for key in all_keys:
                inp = input_stream.get(key)
                out = output_stream.get(key)
                ad_rows.append([
                    _camel_to_title(key),
                    f"{_fmt_num(inp.get('value'))} {inp.get('unit', '')}" if isinstance(inp, dict) else "-",
                    f"{_fmt_num(out.get('value'))} {out.get('unit', '')}" if isinstance(out, dict) else "-",
                ])
            y = _draw_table(c, ad_headers, ad_rows, left_margin, y, [171, 171, 170], page_height=page_height, page_width=page_width)
            y -= 10

    equipment = results.get("equipment") or []
    if isinstance(equipment, list) and len(equipment) > 0:
        y = _add_section_header(c, "Equipment List", y, left_margin, content_width, page_height)
        eq_headers = ["Process", "Equipment", "Qty", "Description", "Design Basis"]
        eq_rows = [[
            _sanitize(eq.get("process", "")),
            _sanitize(eq.get("equipmentType", "")),
            str(eq.get("quantity", 1)),
            _sanitize(eq.get("description", "")),
            _sanitize(eq.get("designBasis", "")),
        ] for eq in equipment]
        y = _draw_table(c, eq_headers, eq_rows, left_margin, y, [90, 100, 32, 160, 130], page_height=page_height, page_width=page_width)
        y -= 15

    assumptions = results.get("assumptions") or []
    if isinstance(assumptions, list) and len(assumptions) > 0:
        y = _add_section_header(c, "Design Assumptions", y, left_margin, content_width, page_height)
        ass_headers = ["Parameter", "Value", "Source"]
        ass_rows = [[_sanitize(a.get("parameter", "")), _sanitize(a.get("value", "")), _sanitize(a.get("source", ""))] for a in assumptions]
        y = _draw_table(c, ass_headers, ass_rows, left_margin, y, [180, 162, 170], page_height=page_height, page_width=page_width)

    c.save()
    buf.seek(0)
    return buf.read()


def export_mass_balance_excel(results: dict, scenario_name: str, project_name: str, project_type: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment

    wb = Workbook()
    wb.remove(wb.active)

    summary = results.get("summary") or {}
    if isinstance(summary, dict) and len(summary) > 0:
        ws = wb.create_sheet("Summary")
        ws.append(["Mass Balance Summary"])
        ws.append([f"Project: {project_name}", f"Scenario: {scenario_name}", f"Type: {project_type} - {TYPE_LABELS.get(project_type, '')}"])
        ws.append([])
        ws.append(["Parameter", "Value", "Unit"])
        for key, val in summary.items():
            if isinstance(val, dict):
                ws.append([_camel_to_title(key), val.get("value", "-"), val.get("unit", "")])
            else:
                ws.append([_camel_to_title(key), val, ""])
        ws.column_dimensions["A"].width = 30
        ws.column_dimensions["B"].width = 20
        ws.column_dimensions["C"].width = 20

    stages = results.get("stages") or []
    if isinstance(stages, list) and len(stages) > 0:
        ws = wb.create_sheet("Treatment Train")
        ws.append(["Treatment Train - Stream Data"])
        conv = results.get("convergenceAchieved")
        ws.append([f"Convergence: {'Yes' if conv else 'No'} ({results.get('convergenceIterations', 0)} iterations)"])
        ws.append([])

        param_labels = {
            "flow": "Flow (GPD)", "bod": "BOD (mg/L)", "cod": "COD (mg/L)",
            "tss": "TSS (mg/L)", "tkn": "TKN (mg/L)", "tp": "TP (mg/L)", "fog": "FOG (mg/L)",
        }
        params = ["flow", "bod", "cod", "tss", "tkn", "tp", "fog"]

        for stage in stages:
            ws.append([f"{stage.get('name', '')} ({stage.get('type', '')})"])
            ws.append(["Parameter", "Influent", "Effluent", "Removal %"])
            influent = stage.get("influent") or {}
            effluent = stage.get("effluent") or {}
            removals = stage.get("removalEfficiencies") or {}
            for p in params:
                ws.append([
                    param_labels.get(p, p.upper()),
                    influent.get(p, ""),
                    effluent.get(p, ""),
                    removals.get(p, ""),
                ])
            ws.append([])
        ws.column_dimensions["A"].width = 25
        ws.column_dimensions["B"].width = 18
        ws.column_dimensions["C"].width = 18
        ws.column_dimensions["D"].width = 15

    ad_stages = results.get("adStages") or []
    if isinstance(ad_stages, list) and len(ad_stages) > 0:
        ws = wb.create_sheet("AD Process")
        ws.append(["AD / RNG Process Stages"])
        ws.append([])
        for stage in ad_stages:
            ws.append([f"{stage.get('name', '')} ({stage.get('type', '')})"])
            ws.append(["Parameter", "Input Value", "Input Unit", "Output Value", "Output Unit"])
            input_stream = stage.get("inputStream") or {}
            output_stream = stage.get("outputStream") or {}
            all_keys = list(dict.fromkeys(list(input_stream.keys()) + list(output_stream.keys())))
            for key in all_keys:
                inp = input_stream.get(key)
                out = output_stream.get(key)
                ws.append([
                    _camel_to_title(key),
                    inp.get("value", "") if isinstance(inp, dict) else "",
                    inp.get("unit", "") if isinstance(inp, dict) else "",
                    out.get("value", "") if isinstance(out, dict) else "",
                    out.get("unit", "") if isinstance(out, dict) else "",
                ])
            ws.append([])
        for col_letter, w in [("A", 25), ("B", 15), ("C", 15), ("D", 15), ("E", 15)]:
            ws.column_dimensions[col_letter].width = w

    equipment = results.get("equipment") or []
    if isinstance(equipment, list) and len(equipment) > 0:
        ws = wb.create_sheet("Equipment")
        ws.append(["Equipment List"])
        ws.append([])
        ws.append(["Process", "Equipment Type", "Qty", "Description", "Design Basis", "Notes"])
        for eq in equipment:
            ws.append([
                eq.get("process", ""),
                eq.get("equipmentType", ""),
                eq.get("quantity", 1),
                eq.get("description", ""),
                eq.get("designBasis", ""),
                eq.get("notes", ""),
            ])
        for col_letter, w in [("A", 20), ("B", 20), ("C", 6), ("D", 35), ("E", 30), ("F", 30)]:
            ws.column_dimensions[col_letter].width = w

    assumptions = results.get("assumptions") or []
    if isinstance(assumptions, list) and len(assumptions) > 0:
        ws = wb.create_sheet("Assumptions")
        ws.append(["Design Assumptions"])
        ws.append([])
        ws.append(["Parameter", "Value", "Source"])
        for a in assumptions:
            ws.append([a.get("parameter", ""), a.get("value", ""), a.get("source", "")])
        ws.column_dimensions["A"].width = 30
        ws.column_dimensions["B"].width = 25
        ws.column_dimensions["C"].width = 30

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output.read()


def export_capex_pdf(results: dict, scenario_name: str, project_name: str, project_type: str) -> bytes:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import HexColor

    page_width, page_height = LETTER
    left_margin = 50
    content_width = page_width - 100

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)

    c.setFont("Helvetica-Bold", 18)
    c.setFillColor(HexColor("#1E3A5F"))
    c.drawCentredString(page_width / 2, page_height - 50, "Capital Cost Estimate")

    c.setFont("Helvetica", 10)
    c.setFillColor(HexColor("#666666"))
    c.drawCentredString(page_width / 2, page_height - 75, f"Project: {_sanitize(project_name)}")
    c.drawCentredString(page_width / 2, page_height - 88, f"Scenario: {_sanitize(scenario_name)}")
    c.drawCentredString(page_width / 2, page_height - 101, f"Type {project_type}: {TYPE_LABELS.get(project_type, project_type)}")
    cost_year = results.get("costYear", "Current")
    currency = results.get("currency", "USD")
    c.drawCentredString(page_width / 2, page_height - 114, f"Cost Year: {cost_year} | Currency: {currency}")
    c.drawCentredString(page_width / 2, page_height - 127, f"Generated: {datetime.now().strftime('%m/%d/%Y')}")

    y = page_height - 155

    summary = results.get("summary") or {}
    if isinstance(summary, dict) and len(summary) > 0:
        y = _add_section_header(c, "Cost Summary", y, left_margin, content_width, page_height)
        sum_rows = [
            ["Total Equipment Cost", _fmt_currency(summary.get("totalEquipmentCost", 0))],
            ["Total Installed Cost", _fmt_currency(summary.get("totalInstalledCost", 0))],
            ["Total Contingency", _fmt_currency(summary.get("totalContingency", 0))],
            ["Total Direct Cost", _fmt_currency(summary.get("totalDirectCost", 0))],
            [f"Engineering ({summary.get('engineeringPct', 15)}%)", _fmt_currency(summary.get("engineeringCost", 0))],
            ["Total Project Cost", _fmt_currency(summary.get("totalProjectCost", 0))],
        ]
        cpu = summary.get("costPerUnit")
        if isinstance(cpu, dict):
            sum_rows.append([f"Cost per Unit ({cpu.get('basis', '')})", f"{_fmt_currency(cpu.get('value', 0))} / {cpu.get('unit', '')}"])
        y = _draw_table(c, ["Item", "Amount"], sum_rows, left_margin, y, [300, 212],
                        header_bg="#1E3A5F", page_height=page_height, page_width=page_width)
        y -= 15

    line_items = results.get("lineItems") or []
    if isinstance(line_items, list) and len(line_items) > 0:
        y = _add_section_header(c, "Line Items", y, left_margin, content_width, page_height)
        li_headers = ["Process", "Equipment", "Qty", "Base Cost", "Install Factor", "Installed", "Contingency", "Total"]
        li_rows = [[
            _sanitize(li.get("process", "")),
            _sanitize(li.get("equipmentType", "")),
            str(li.get("quantity", 1)),
            _fmt_currency(li.get("baseCostPerUnit", 0)),
            f"{_fmt_num(li.get('installationFactor', 0), 2)}x",
            _fmt_currency(li.get("installedCost", 0)),
            _fmt_currency(li.get("contingencyCost", 0)),
            _fmt_currency(li.get("totalCost", 0)),
        ] for li in line_items]
        y = _draw_table(c, li_headers, li_rows, left_margin, y, [80, 80, 28, 64, 52, 72, 64, 72],
                        font_size=7, page_height=page_height, page_width=page_width)
        y -= 15

    assumptions = results.get("assumptions") or []
    if isinstance(assumptions, list) and len(assumptions) > 0:
        y = _add_section_header(c, "Assumptions", y, left_margin, content_width, page_height)
        ass_headers = ["Parameter", "Value", "Source"]
        ass_rows = [[_sanitize(a.get("parameter", "")), _sanitize(a.get("value", "")), _sanitize(a.get("source", ""))] for a in assumptions]
        y = _draw_table(c, ass_headers, ass_rows, left_margin, y, [180, 162, 170], page_height=page_height, page_width=page_width)

    methodology = results.get("methodology")
    if methodology:
        if y < 100:
            c.showPage()
            y = page_height - 50
        y = _add_section_header(c, "Methodology", y, left_margin, content_width, page_height)
        c.setFont("Helvetica", 9)
        c.setFillColor(HexColor("#333333"))
        for line in _wrap_text(_sanitize(methodology), content_width, "Helvetica", 9):
            c.drawString(left_margin, y, line)
            y -= 12

    c.save()
    buf.seek(0)
    return buf.read()


def export_capex_excel(results: dict, scenario_name: str, project_name: str, project_type: str) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    wb.remove(wb.active)

    summary = results.get("summary") or {}
    if isinstance(summary, dict) and len(summary) > 0:
        ws = wb.create_sheet("Summary")
        ws.append(["Capital Cost Estimate - Summary"])
        ws.append([f"Project: {project_name}", f"Scenario: {scenario_name}", f"Type: {project_type} - {TYPE_LABELS.get(project_type, '')}"])
        cost_year = results.get("costYear", "Current")
        currency = results.get("currency", "USD")
        ws.append([f"Cost Year: {cost_year}", f"Currency: {currency}"])
        ws.append([])
        ws.append(["Item", "Amount ($)"])
        ws.append(["Total Equipment Cost", summary.get("totalEquipmentCost", 0)])
        ws.append(["Total Installed Cost", summary.get("totalInstalledCost", 0)])
        ws.append(["Total Contingency", summary.get("totalContingency", 0)])
        ws.append(["Total Direct Cost", summary.get("totalDirectCost", 0)])
        ws.append([f"Engineering ({summary.get('engineeringPct', 15)}%)", summary.get("engineeringCost", 0)])
        ws.append(["Total Project Cost", summary.get("totalProjectCost", 0)])
        cpu = summary.get("costPerUnit")
        if isinstance(cpu, dict):
            ws.append([f"Cost per Unit ({cpu.get('basis', '')} - {cpu.get('unit', '')})", cpu.get("value", 0)])
        ws.column_dimensions["A"].width = 40
        ws.column_dimensions["B"].width = 20
        ws.column_dimensions["C"].width = 30

    line_items = results.get("lineItems") or []
    if isinstance(line_items, list) and len(line_items) > 0:
        ws = wb.create_sheet("Line Items")
        ws.append(["Line Items"])
        ws.append([])
        ws.append([
            "Process", "Equipment Type", "Description", "Qty",
            "Base Cost/Unit ($)", "Installation Factor", "Installed Cost ($)",
            "Contingency %", "Contingency ($)", "Total Cost ($)",
            "Cost Basis", "Source", "Notes",
        ])
        for li in line_items:
            ws.append([
                li.get("process", ""),
                li.get("equipmentType", ""),
                li.get("description", ""),
                li.get("quantity", 1),
                li.get("baseCostPerUnit", 0),
                li.get("installationFactor", 0),
                li.get("installedCost", 0),
                li.get("contingencyPct", 0),
                li.get("contingencyCost", 0),
                li.get("totalCost", 0),
                li.get("costBasis", ""),
                li.get("source", ""),
                li.get("notes", ""),
            ])
        for col_letter, w in [("A", 18), ("B", 20), ("C", 30), ("D", 6),
                               ("E", 15), ("F", 12), ("G", 15), ("H", 10),
                               ("I", 15), ("J", 15), ("K", 20), ("L", 20), ("M", 25)]:
            ws.column_dimensions[col_letter].width = w

    assumptions = results.get("assumptions") or []
    if isinstance(assumptions, list) and len(assumptions) > 0:
        ws = wb.create_sheet("Assumptions")
        ws.append(["Assumptions"])
        ws.append([])
        ws.append(["Parameter", "Value", "Source"])
        for a in assumptions:
            ws.append([a.get("parameter", ""), a.get("value", ""), a.get("source", "")])
        ws.column_dimensions["A"].width = 30
        ws.column_dimensions["B"].width = 25
        ws.column_dimensions["C"].width = 30

    capex_output = io.BytesIO()
    wb.save(capex_output)
    capex_output.seek(0)
    return capex_output.read()


def export_opex_pdf(results: dict, scenario_name: str, project_name: str, project_type: str) -> bytes:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import HexColor

    page_width, page_height = LETTER
    left_margin = 50
    content_width = page_width - 100

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)

    c.setFont("Helvetica-Bold", 18)
    c.setFillColor(HexColor("#1E3A5F"))
    c.drawCentredString(page_width / 2, page_height - 50, "Annual Operating Cost Estimate")

    c.setFont("Helvetica", 10)
    c.setFillColor(HexColor("#666666"))
    c.drawCentredString(page_width / 2, page_height - 75, f"Project: {_sanitize(project_name)}")
    c.drawCentredString(page_width / 2, page_height - 88, f"Scenario: {_sanitize(scenario_name)}")
    c.drawCentredString(page_width / 2, page_height - 101, f"Type {project_type}: {TYPE_LABELS.get(project_type, project_type)}")
    cost_year = results.get("costYear", "Current")
    currency = results.get("currency", "USD")
    c.drawCentredString(page_width / 2, page_height - 114, f"Cost Year: {cost_year} | Currency: {currency}")
    c.drawCentredString(page_width / 2, page_height - 127, f"Generated: {datetime.now().strftime('%m/%d/%Y')}")

    y = page_height - 155

    summary = results.get("summary") or {}
    if isinstance(summary, dict) and len(summary) > 0:
        y = _add_section_header(c, "Cost Summary", y, left_margin, content_width, page_height)
        sum_rows = [
            ["Total Annual OpEx", _fmt_currency(summary.get("totalAnnualOpex", 0))],
            ["Labor", _fmt_currency(summary.get("totalLaborCost", 0))],
            ["Energy", _fmt_currency(summary.get("totalEnergyCost", 0))],
            ["Chemicals", _fmt_currency(summary.get("totalChemicalCost", 0))],
            ["Maintenance", _fmt_currency(summary.get("totalMaintenanceCost", 0))],
            ["Disposal", _fmt_currency(summary.get("totalDisposalCost", 0))],
            ["Other", _fmt_currency(summary.get("totalOtherCost", 0))],
            ["Revenue Offsets", _fmt_currency(summary.get("revenueOffsets", 0))],
            ["Net Annual OpEx", _fmt_currency(summary.get("netAnnualOpex", 0))],
        ]
        opex_pct = summary.get("opexAsPercentOfCapex")
        if opex_pct is not None:
            sum_rows.append(["OpEx as % of CapEx", f"{_fmt_num(opex_pct)}%"])
        opu = summary.get("opexPerUnit")
        if isinstance(opu, dict):
            sum_rows.append([f"OpEx per Unit ({opu.get('basis', '')})", f"{_fmt_currency(opu.get('value', 0))} / {opu.get('unit', '')}"])
        y = _draw_table(c, ["Item", "Amount"], sum_rows, left_margin, y, [300, 212],
                        header_bg="#1E3A5F", page_height=page_height, page_width=page_width)
        y -= 15

    line_items = results.get("lineItems") or []
    if isinstance(line_items, list) and len(line_items) > 0:
        y = _add_section_header(c, "Line Items", y, left_margin, content_width, page_height)
        li_headers = ["Category", "Description", "Annual Cost ($)", "Unit Cost", "Unit Basis", "Scaling Basis", "Source"]
        li_rows = [[
            _sanitize(li.get("category", "")),
            _sanitize(li.get("description", "")),
            _fmt_currency(li.get("annualCost", 0)),
            _fmt_currency(li.get("unitCost", 0)) if li.get("unitCost") is not None else "-",
            _sanitize(li.get("unitBasis", "-") or "-"),
            _sanitize(li.get("scalingBasis", "-") or "-"),
            _sanitize(li.get("source", "")),
        ] for li in line_items]
        y = _draw_table(c, li_headers, li_rows, left_margin, y, [72, 100, 72, 64, 64, 68, 72],
                        font_size=7, page_height=page_height, page_width=page_width)
        y -= 15

    assumptions = results.get("assumptions") or []
    if isinstance(assumptions, list) and len(assumptions) > 0:
        y = _add_section_header(c, "Assumptions", y, left_margin, content_width, page_height)
        ass_headers = ["Parameter", "Value", "Source"]
        ass_rows = [[_sanitize(a.get("parameter", "")), _sanitize(a.get("value", "")), _sanitize(a.get("source", ""))] for a in assumptions]
        y = _draw_table(c, ass_headers, ass_rows, left_margin, y, [180, 162, 170], page_height=page_height, page_width=page_width)

    methodology = results.get("methodology")
    if methodology:
        if y < 100:
            c.showPage()
            y = page_height - 50
        y = _add_section_header(c, "Methodology", y, left_margin, content_width, page_height)
        c.setFont("Helvetica", 9)
        c.setFillColor(HexColor("#333333"))
        for line in _wrap_text(_sanitize(methodology), content_width, "Helvetica", 9):
            c.drawString(left_margin, y, line)
            y -= 12

    c.save()
    buf.seek(0)
    return buf.read()


def export_opex_excel(results: dict, scenario_name: str, project_name: str, project_type: str) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    wb.remove(wb.active)

    summary = results.get("summary") or {}
    if isinstance(summary, dict) and len(summary) > 0:
        ws = wb.create_sheet("Summary")
        ws.append(["Annual Operating Cost Estimate - Summary"])
        ws.append([f"Project: {project_name}", f"Scenario: {scenario_name}", f"Type: {project_type} - {TYPE_LABELS.get(project_type, '')}"])
        cost_year = results.get("costYear", "Current")
        currency = results.get("currency", "USD")
        ws.append([f"Cost Year: {cost_year}", f"Currency: {currency}"])
        ws.append([])
        ws.append(["Item", "Amount ($)"])
        ws.append(["Total Annual OpEx", summary.get("totalAnnualOpex", 0)])
        ws.append(["Labor", summary.get("totalLaborCost", 0)])
        ws.append(["Energy", summary.get("totalEnergyCost", 0)])
        ws.append(["Chemicals", summary.get("totalChemicalCost", 0)])
        ws.append(["Maintenance", summary.get("totalMaintenanceCost", 0)])
        ws.append(["Disposal", summary.get("totalDisposalCost", 0)])
        ws.append(["Other", summary.get("totalOtherCost", 0)])
        ws.append(["Revenue Offsets", summary.get("revenueOffsets", 0)])
        ws.append(["Net Annual OpEx", summary.get("netAnnualOpex", 0)])
        opex_pct = summary.get("opexAsPercentOfCapex")
        if opex_pct is not None:
            ws.append(["OpEx as % of CapEx", opex_pct])
        opu = summary.get("opexPerUnit")
        if isinstance(opu, dict):
            ws.append([f"OpEx per Unit ({opu.get('basis', '')} - {opu.get('unit', '')})", opu.get("value", 0)])
        ws.column_dimensions["A"].width = 40
        ws.column_dimensions["B"].width = 20
        ws.column_dimensions["C"].width = 30

    line_items = results.get("lineItems") or []
    if isinstance(line_items, list) and len(line_items) > 0:
        ws = wb.create_sheet("Line Items")
        ws.append(["Line Items"])
        ws.append([])
        ws.append([
            "Category", "Description", "Annual Cost ($)", "Unit Cost ($)",
            "Unit Basis", "Scaling Basis", "Cost Basis", "Source", "Notes",
        ])
        for li in line_items:
            ws.append([
                li.get("category", ""),
                li.get("description", ""),
                li.get("annualCost", 0),
                li.get("unitCost", ""),
                li.get("unitBasis", ""),
                li.get("scalingBasis", ""),
                li.get("costBasis", ""),
                li.get("source", ""),
                li.get("notes", ""),
            ])
        for col_letter, w in [("A", 18), ("B", 30), ("C", 15), ("D", 15),
                               ("E", 15), ("F", 15), ("G", 20), ("H", 20), ("I", 25)]:
            ws.column_dimensions[col_letter].width = w

    assumptions = results.get("assumptions") or []
    if isinstance(assumptions, list) and len(assumptions) > 0:
        ws = wb.create_sheet("Assumptions")
        ws.append(["Assumptions"])
        ws.append([])
        ws.append(["Parameter", "Value", "Source"])
        for a in assumptions:
            ws.append([a.get("parameter", ""), a.get("value", ""), a.get("source", "")])
        ws.column_dimensions["A"].width = 30
        ws.column_dimensions["B"].width = 25
        ws.column_dimensions["C"].width = 30

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output.read()


def export_vendor_list_pdf(
    vendor_list: dict,
    scenario_name: str,
    project_name: str,
    project_type: str,
) -> bytes:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.colors import HexColor

    buf = io.BytesIO()
    page_w, page_h = letter
    c = pdf_canvas.Canvas(buf, pagesize=letter)
    left = 50
    content_w = page_w - 100

    c.setFont("Helvetica-Bold", 18)
    c.setFillColor(HexColor("#1E3A5F"))
    c.drawCentredString(page_w / 2, page_h - 50, "Recommended Vendor List")

    c.setFont("Helvetica", 10)
    c.setFillColor(HexColor("#666666"))
    c.drawCentredString(page_w / 2, page_h - 70, f"Project: {_sanitize(project_name)}")
    c.drawCentredString(page_w / 2, page_h - 83, f"Scenario: {_sanitize(scenario_name)}")
    type_label = TYPE_LABELS.get(project_type.upper(), project_type)
    c.drawCentredString(page_w / 2, page_h - 96, f"Type {project_type}: {type_label}")
    generated_at = vendor_list.get("generatedAt") or vendor_list.get("generated_at") or ""
    model_used = vendor_list.get("modelUsed") or vendor_list.get("model_used") or ""
    if generated_at:
        try:
            from datetime import datetime as _dt
            dt = _dt.fromisoformat(generated_at.replace("Z", "+00:00"))
            generated_at = dt.strftime("%m/%d/%Y")
        except Exception:
            pass
    c.drawCentredString(page_w / 2, page_h - 109, f"Generated: {generated_at}")
    c.drawCentredString(page_w / 2, page_h - 122, f"Model: {_sanitize(model_used)}")

    y = page_h - 150

    items = vendor_list.get("items", [])
    for item in items:
        eq_type = _sanitize(item.get("equipmentType") or item.get("equipment_type") or "")
        process = _sanitize(item.get("process", ""))
        quantity = item.get("quantity", 1)
        specs_summary = _sanitize(item.get("specsSummary") or item.get("specs_summary") or "")

        if y < 120:
            c.showPage()
            y = page_h - 50

        c.setFillColor(HexColor("#2563EB"))
        c.rect(left, y - 16, content_w, 20, fill=1, stroke=0)
        c.setFillColor(HexColor("#FFFFFF"))
        c.setFont("Helvetica-Bold", 10)
        c.drawString(left + 6, y - 12, f"{eq_type} -- {process}")
        y -= 24

        c.setFillColor(HexColor("#333333"))
        c.setFont("Helvetica", 8)
        c.drawString(left + 6, y, f"Quantity: {quantity}")
        y -= 12

        if specs_summary:
            c.setFillColor(HexColor("#555555"))
            c.setFont("Helvetica", 8)
            wrapped = _wrap_text(f"Specs: {specs_summary}", content_w - 12, "Helvetica", 8)
            for line in wrapped:
                if y < 50:
                    c.showPage()
                    y = page_h - 50
                c.drawString(left + 6, y, line)
                y -= 11
            y -= 2

        recommendations = item.get("recommendations", [])
        if recommendations:
            headers = ["#", "Manufacturer", "Model Number", "Website", "Notes"]
            col_widths = [20, 110, 120, 130, content_w - 380]
            rows = []
            for idx, rec in enumerate(recommendations):
                rows.append([
                    str(idx + 1),
                    _sanitize(rec.get("manufacturer", "")),
                    _sanitize(rec.get("modelNumber") or rec.get("model_number") or ""),
                    _sanitize(rec.get("websiteUrl") or rec.get("website_url") or rec.get("specSheetUrl") or rec.get("spec_sheet_url") or ""),
                    _sanitize(rec.get("notes", "")),
                ])
            y = _draw_table(c, headers, rows, left, y, col_widths, font_size=7)

        y -= 12

    c.save()
    buf.seek(0)
    return buf.read()
