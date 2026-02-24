import os
import uuid
import json
import logging
from datetime import datetime
from typing import Optional

from databricks.sql import connect
from databricks.sdk.core import Config

logger = logging.getLogger(__name__)

CATALOG = os.environ.get("DATABRICKS_CATALOG", "burnham_rng")

JSON_FIELDS_UPIF = [
    "feedstock_parameters", "feedstock_specs", "feedstocks",
    "output_specs", "constraints", "confirmed_fields",
    "validation_warnings", "unmapped_specs", "performance_targets",
]
JSON_FIELDS_SCENARIO = ["clarifying_questions", "clarifying_answers"]
JSON_FIELDS_CHAT = ["applied_updates"]


DATABRICKS_HOST = os.environ.get("DATABRICKS_HOST", "adb-582457799522203.3.azuredatabricks.net")
DATABRICKS_HTTP_PATH = os.environ.get("DATABRICKS_HTTP_PATH", "/sql/1.0/warehouses/7740505e6e4de417")

_cfg = None

def _get_config() -> Config:
    global _cfg
    if _cfg is None:
        host = DATABRICKS_HOST
        if not host.startswith("https://"):
            host = f"https://{host}"
        _cfg = Config(host=host)
    return _cfg


def get_connection():
    cfg = _get_config()

    return connect(
        server_hostname=DATABRICKS_HOST,
        http_path=DATABRICKS_HTTP_PATH,
        credentials_provider=lambda: cfg.authenticate,
        catalog=CATALOG,
    )


def _row_to_dict(cursor, row):
    columns = [desc[0] for desc in cursor.description]
    return dict(zip(columns, row))


def _rows_to_dicts(cursor, rows):
    columns = [desc[0] for desc in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


def _serialize_json(value):
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value)


def _deserialize_json(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value


def _deserialize_fields(row_dict, fields):
    for field in fields:
        if field in row_dict:
            row_dict[field] = _deserialize_json(row_dict[field])
    return row_dict


class DatabricksStorage:

    def _t(self, schema, table):
        return f"{CATALOG}.{schema}.{table}"

    @property
    def _projects(self):
        return self._t("project_intakes", "projects")

    @property
    def _scenarios(self):
        return self._t("project_intakes", "scenarios")

    @property
    def _text_entries(self):
        return self._t("project_intakes", "text_entries")

    @property
    def _extracted_parameters(self):
        return self._t("project_intakes", "extracted_parameters")

    @property
    def _upif_records(self):
        return self._t("project_intakes", "upif_records")

    @property
    def _upif_chat_messages(self):
        return self._t("project_intakes", "upif_chat_messages")

    @property
    def _prompt_templates(self):
        return self._t("project_intakes", "prompt_templates")

    @property
    def _documents(self):
        return self._t("raw_documents", "documents")

    @property
    def _mass_balance_runs(self):
        return self._t("project_intakes", "mass_balance_runs")

    @property
    def _capex_estimates(self):
        return self._t("project_intakes", "capex_estimates")

    @property
    def _opex_estimates(self):
        return self._t("project_intakes", "opex_estimates")

    @property
    def _financial_models(self):
        return self._t("project_intakes", "financial_models")

    @property
    def _generation_logs(self):
        return self._t("project_intakes", "generation_logs")

    # ========================================================================
    # PROJECTS
    # ========================================================================

    def create_project(self, name: str, description: Optional[str] = None) -> dict:
        project_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._projects} (id, name, description, created_at) "
                    "VALUES (?, ?, ?, ?)",
                    (project_id, name, description, now),
                )
                cur.execute(
                    f"SELECT * FROM {self._projects} WHERE id = ?",
                    (project_id,),
                )
                row = cur.fetchone()
                return _row_to_dict(cur, row)

    def get_projects(self) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._projects} ORDER BY created_at DESC"
                )
                rows = cur.fetchall()
                return _rows_to_dicts(cur, rows)

    def get_project(self, project_id: str) -> Optional[dict]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._projects} WHERE id = ?",
                    (project_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                return _row_to_dict(cur, row)

    def delete_project(self, project_id: str):
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self._projects} WHERE id = ?",
                    (project_id,),
                )

    # ========================================================================
    # SCENARIOS
    # ========================================================================

    def create_scenario(
        self,
        project_id: str,
        name: str,
        status: str = "draft",
        preferred_model: str = "databricks-gpt-5-2-codex",
    ) -> dict:
        scenario_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._scenarios} "
                    "(id, project_id, name, status, preferred_model, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (scenario_id, project_id, name, status, preferred_model, now),
                )
                cur.execute(
                    f"SELECT * FROM {self._scenarios} WHERE id = ?",
                    (scenario_id,),
                )
                row = cur.fetchone()
                return _deserialize_fields(
                    _row_to_dict(cur, row), JSON_FIELDS_SCENARIO
                )

    def get_scenarios(self, project_id: str) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._scenarios} "
                    "WHERE project_id = ? ORDER BY created_at DESC",
                    (project_id,),
                )
                rows = cur.fetchall()
                return [
                    _deserialize_fields(d, JSON_FIELDS_SCENARIO)
                    for d in _rows_to_dicts(cur, rows)
                ]

    def get_scenario(self, scenario_id: str) -> Optional[dict]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT s.*, p.name AS project_name "
                    f"FROM {self._scenarios} s "
                    f"LEFT JOIN {self._projects} p ON s.project_id = p.id "
                    "WHERE s.id = ?",
                    (scenario_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                return _deserialize_fields(
                    _row_to_dict(cur, row), JSON_FIELDS_SCENARIO
                )

    def get_recent_scenarios(self) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT s.*, p.name AS project_name "
                    f"FROM {self._scenarios} s "
                    f"INNER JOIN {self._projects} p ON s.project_id = p.id "
                    f"ORDER BY s.created_at DESC"
                )
                rows = cur.fetchall()
                return [
                    _deserialize_fields(d, JSON_FIELDS_SCENARIO)
                    for d in _rows_to_dicts(cur, rows)
                ]

    def update_scenario(self, scenario_id: str, updates: dict) -> Optional[dict]:
        if not updates:
            return self.get_scenario(scenario_id)

        json_fields = set(JSON_FIELDS_SCENARIO)
        set_clauses = []
        params = []
        for key, value in updates.items():
            set_clauses.append(f"{key} = ?")
            if key in json_fields:
                params.append(_serialize_json(value))
            else:
                params.append(value)

        params.append(scenario_id)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {self._scenarios} SET {', '.join(set_clauses)} "
                    "WHERE id = ?",
                    tuple(params),
                )
                cur.execute(
                    f"SELECT s.*, p.name AS project_name "
                    f"FROM {self._scenarios} s "
                    f"LEFT JOIN {self._projects} p ON s.project_id = p.id "
                    "WHERE s.id = ?",
                    (scenario_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                return _deserialize_fields(
                    _row_to_dict(cur, row), JSON_FIELDS_SCENARIO
                )

    def update_scenario_project_type(
        self, scenario_id: str, project_type: str, confirmed: bool
    ) -> dict:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {self._scenarios} "
                    "SET project_type = ?, project_type_confirmed = ? "
                    "WHERE id = ?",
                    (project_type, confirmed, scenario_id),
                )
                cur.execute(
                    f"SELECT s.*, p.name AS project_name "
                    f"FROM {self._scenarios} s "
                    f"LEFT JOIN {self._projects} p ON s.project_id = p.id "
                    "WHERE s.id = ?",
                    (scenario_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return {}
                return _deserialize_fields(
                    _row_to_dict(cur, row), JSON_FIELDS_SCENARIO
                )

    def delete_scenario(self, scenario_id: str):
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self._scenarios} WHERE id = ?",
                    (scenario_id,),
                )

    # ========================================================================
    # TEXT ENTRIES
    # ========================================================================

    def create_text_entry(
        self,
        scenario_id: str,
        content: str,
        category: Optional[str] = None,
    ) -> dict:
        entry_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._text_entries} "
                    "(id, scenario_id, content, category, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (entry_id, scenario_id, content, category, now),
                )
                cur.execute(
                    f"SELECT * FROM {self._text_entries} WHERE id = ?",
                    (entry_id,),
                )
                row = cur.fetchone()
                return _row_to_dict(cur, row)

    def get_text_entries(self, scenario_id: str) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._text_entries} "
                    "WHERE scenario_id = ? ORDER BY created_at DESC",
                    (scenario_id,),
                )
                rows = cur.fetchall()
                return _rows_to_dicts(cur, rows)

    def delete_text_entry(self, entry_id: str):
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self._text_entries} WHERE id = ?",
                    (entry_id,),
                )

    # ========================================================================
    # DOCUMENTS
    # ========================================================================

    def create_document(
        self,
        scenario_id: str,
        filename: str,
        original_name: str,
        mime_type: str,
        size: str,
        extracted_text: Optional[str] = None,
    ) -> dict:
        doc_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._documents} "
                    "(id, scenario_id, filename, original_name, mime_type, size, extracted_text, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (doc_id, scenario_id, filename, original_name, mime_type, size, extracted_text, now),
                )
                cur.execute(
                    f"SELECT * FROM {self._documents} WHERE id = ?",
                    (doc_id,),
                )
                row = cur.fetchone()
                return _row_to_dict(cur, row)

    def get_documents(self, scenario_id: str) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._documents} "
                    "WHERE scenario_id = ? ORDER BY created_at DESC",
                    (scenario_id,),
                )
                rows = cur.fetchall()
                return _rows_to_dicts(cur, rows)

    def get_document(self, doc_id: str) -> Optional[dict]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._documents} WHERE id = ?",
                    (doc_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                return _row_to_dict(cur, row)

    def update_document(self, doc_id: str, updates: dict) -> Optional[dict]:
        if not updates:
            return self.get_document(doc_id)

        set_clauses = []
        params = []
        for key, value in updates.items():
            set_clauses.append(f"{key} = ?")
            params.append(value)

        params.append(doc_id)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {self._documents} SET {', '.join(set_clauses)} "
                    "WHERE id = ?",
                    tuple(params),
                )
                cur.execute(
                    f"SELECT * FROM {self._documents} WHERE id = ?",
                    (doc_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                return _row_to_dict(cur, row)

    def delete_document(self, doc_id: str):
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self._documents} WHERE id = ?",
                    (doc_id,),
                )

    # ========================================================================
    # EXTRACTED PARAMETERS
    # ========================================================================

    def create_parameter(
        self,
        scenario_id: str,
        category: str,
        name: str,
        value: Optional[str] = None,
        unit: Optional[str] = None,
        source: str = "user_input",
        confidence: Optional[str] = None,
    ) -> dict:
        param_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._extracted_parameters} "
                    "(id, scenario_id, category, name, value, unit, source, confidence, is_confirmed, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (param_id, scenario_id, category, name, value, unit, source, confidence, False, now),
                )
                cur.execute(
                    f"SELECT * FROM {self._extracted_parameters} WHERE id = ?",
                    (param_id,),
                )
                row = cur.fetchone()
                return _row_to_dict(cur, row)

    def get_parameters(self, scenario_id: str) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._extracted_parameters} "
                    "WHERE scenario_id = ? ORDER BY category, name",
                    (scenario_id,),
                )
                rows = cur.fetchall()
                return _rows_to_dicts(cur, rows)

    def delete_parameters(self, scenario_id: str):
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self._extracted_parameters} WHERE scenario_id = ?",
                    (scenario_id,),
                )

    def delete_and_insert_parameters(self, scenario_id: str, params: list) -> list:
        """Delete existing params and insert new ones in a single connection."""
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self._extracted_parameters} WHERE scenario_id = ?",
                    (scenario_id,),
                )
                inserted_ids = []
                for p in params:
                    param_id = str(uuid.uuid4())
                    inserted_ids.append(param_id)
                    cur.execute(
                        f"INSERT INTO {self._extracted_parameters} "
                        "(id, scenario_id, category, name, value, unit, source, confidence, is_confirmed, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (param_id, scenario_id, p["category"], p["name"],
                         p.get("value"), p.get("unit"),
                         p.get("source", "ai_extraction"),
                         p.get("confidence"), False, now),
                    )
                if inserted_ids:
                    placeholders = ",".join("?" for _ in inserted_ids)
                    cur.execute(
                        f"SELECT * FROM {self._extracted_parameters} WHERE id IN ({placeholders})",
                        inserted_ids,
                    )
                    rows = cur.fetchall()
                    return _rows_to_dicts(cur, rows)
                return []

    # ========================================================================
    # UPIF RECORDS
    # ========================================================================

    def create_upif(self, data: dict) -> dict:
        upif_id = str(uuid.uuid4())
        now = datetime.utcnow()

        scenario_id = data["scenario_id"]
        feedstock_type = data.get("feedstock_type")
        feedstock_volume = data.get("feedstock_volume")
        feedstock_unit = data.get("feedstock_unit")
        feedstock_parameters = _serialize_json(data.get("feedstock_parameters"))
        feedstock_specs = _serialize_json(data.get("feedstock_specs"))
        feedstocks = _serialize_json(data.get("feedstocks"))
        output_requirements = data.get("output_requirements")
        output_specs = _serialize_json(data.get("output_specs"))
        location = data.get("location")
        constraints = _serialize_json(data.get("constraints"))
        confirmed_fields = _serialize_json(data.get("confirmed_fields"))
        validation_warnings = _serialize_json(data.get("validation_warnings"))
        unmapped_specs = _serialize_json(data.get("unmapped_specs"))
        performance_targets = _serialize_json(data.get("performance_targets"))
        is_confirmed = data.get("is_confirmed", False)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._upif_records} "
                    "(id, scenario_id, feedstock_type, feedstock_volume, feedstock_unit, "
                    "feedstock_parameters, feedstock_specs, feedstocks, output_requirements, "
                    "output_specs, location, constraints, confirmed_fields, "
                    "validation_warnings, unmapped_specs, performance_targets, "
                    "is_confirmed, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        upif_id, scenario_id, feedstock_type, feedstock_volume, feedstock_unit,
                        feedstock_parameters, feedstock_specs, feedstocks, output_requirements,
                        output_specs, location, constraints, confirmed_fields,
                        validation_warnings, unmapped_specs, performance_targets,
                        is_confirmed, now, now,
                    ),
                )
                cur.execute(
                    f"SELECT * FROM {self._upif_records} WHERE id = ?",
                    (upif_id,),
                )
                row = cur.fetchone()
                return _deserialize_fields(
                    _row_to_dict(cur, row), JSON_FIELDS_UPIF
                )

    def get_upif(self, scenario_id: str) -> Optional[dict]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._upif_records} WHERE scenario_id = ?",
                    (scenario_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                return _deserialize_fields(
                    _row_to_dict(cur, row), JSON_FIELDS_UPIF
                )

    def update_upif(self, scenario_id: str, updates: dict) -> Optional[dict]:
        if not updates:
            return self.get_upif(scenario_id)

        json_fields = set(JSON_FIELDS_UPIF)
        set_clauses = ["updated_at = ?"]
        params = [datetime.utcnow()]

        for key, value in updates.items():
            set_clauses.append(f"{key} = ?")
            if key in json_fields:
                params.append(_serialize_json(value))
            else:
                params.append(value)

        params.append(scenario_id)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {self._upif_records} SET {', '.join(set_clauses)} "
                    "WHERE scenario_id = ?",
                    tuple(params),
                )
                cur.execute(
                    f"SELECT * FROM {self._upif_records} WHERE scenario_id = ?",
                    (scenario_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                return _deserialize_fields(
                    _row_to_dict(cur, row), JSON_FIELDS_UPIF
                )

    def confirm_upif(self, scenario_id: str) -> Optional[dict]:
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {self._upif_records} "
                    "SET is_confirmed = ?, confirmed_at = ?, updated_at = ? "
                    "WHERE scenario_id = ?",
                    (True, now, now, scenario_id),
                )
                cur.execute(
                    f"SELECT * FROM {self._upif_records} WHERE scenario_id = ?",
                    (scenario_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                return _deserialize_fields(
                    _row_to_dict(cur, row), JSON_FIELDS_UPIF
                )

    def delete_upif(self, scenario_id: str):
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self._upif_records} WHERE scenario_id = ?",
                    (scenario_id,),
                )

    # ========================================================================
    # UPIF CHAT MESSAGES
    # ========================================================================

    def create_chat_message(
        self,
        scenario_id: str,
        role: str,
        content: str,
        applied_updates: Optional[dict] = None,
    ) -> dict:
        msg_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._upif_chat_messages} "
                    "(id, scenario_id, role, content, applied_updates, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (msg_id, scenario_id, role, content, _serialize_json(applied_updates), now),
                )
                cur.execute(
                    f"SELECT * FROM {self._upif_chat_messages} WHERE id = ?",
                    (msg_id,),
                )
                row = cur.fetchone()
                return _deserialize_fields(
                    _row_to_dict(cur, row), JSON_FIELDS_CHAT
                )

    def get_chat_messages(self, scenario_id: str) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._upif_chat_messages} "
                    "WHERE scenario_id = ? ORDER BY created_at ASC",
                    (scenario_id,),
                )
                rows = cur.fetchall()
                return [
                    _deserialize_fields(d, JSON_FIELDS_CHAT)
                    for d in _rows_to_dicts(cur, rows)
                ]

    # ========================================================================
    # PROMPT TEMPLATES
    # ========================================================================

    def get_prompt_templates(self) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._prompt_templates} ORDER BY key"
                )
                rows = cur.fetchall()
                return _rows_to_dicts(cur, rows)

    def get_prompt_template(self, key: str) -> Optional[dict]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._prompt_templates} WHERE key = ?",
                    (key,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                return _row_to_dict(cur, row)

    def upsert_prompt_template(
        self,
        key: str,
        name: str,
        description: Optional[str] = None,
        template: str = "",
        is_system_prompt: bool = True,
    ) -> dict:
        now = datetime.utcnow()
        existing = self.get_prompt_template(key)

        with get_connection() as conn:
            with conn.cursor() as cur:
                if existing:
                    cur.execute(
                        f"UPDATE {self._prompt_templates} "
                        "SET name = ?, description = ?, template = ?, "
                        "is_system_prompt = ?, updated_at = ? "
                        "WHERE key = ?",
                        (name, description, template, is_system_prompt, now, key),
                    )
                    cur.execute(
                        f"SELECT * FROM {self._prompt_templates} WHERE key = ?",
                        (key,),
                    )
                else:
                    template_id = str(uuid.uuid4())
                    cur.execute(
                        f"INSERT INTO {self._prompt_templates} "
                        "(id, key, name, description, template, is_system_prompt, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (template_id, key, name, description, template, is_system_prompt, now),
                    )
                    cur.execute(
                        f"SELECT * FROM {self._prompt_templates} WHERE id = ?",
                        (template_id,),
                    )
                row = cur.fetchone()
                return _row_to_dict(cur, row)

    def delete_prompt_template(self, key: str):
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self._prompt_templates} WHERE key = ?",
                    (key,),
                )

    # ========================================================================
    # MASS BALANCE RUNS
    # ========================================================================

    JSON_FIELDS_MB = ["input_snapshot", "results", "overrides", "locks"]

    def get_mass_balance_runs_by_scenario(self, scenario_id: str) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._mass_balance_runs} "
                    "WHERE scenario_id = ? ORDER BY created_at DESC",
                    (scenario_id,),
                )
                rows = cur.fetchall()
                return [
                    _deserialize_fields(_row_to_dict(cur, r), self.JSON_FIELDS_MB)
                    for r in rows
                ]

    def get_mass_balance_run(self, run_id: str) -> Optional[dict]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._mass_balance_runs} WHERE id = ?",
                    (run_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_MB)

    def create_mass_balance_run(
        self,
        scenario_id: str,
        version: str = "1",
        status: str = "draft",
        input_snapshot=None,
        results=None,
        overrides=None,
        locks=None,
    ) -> dict:
        run_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._mass_balance_runs} "
                    "(id, scenario_id, version, status, input_snapshot, results, "
                    "overrides, locks, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        run_id, scenario_id, version, status,
                        _serialize_json(input_snapshot),
                        _serialize_json(results),
                        _serialize_json(overrides),
                        _serialize_json(locks),
                        now, now,
                    ),
                )
                cur.execute(
                    f"SELECT * FROM {self._mass_balance_runs} WHERE id = ?",
                    (run_id,),
                )
                row = cur.fetchone()
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_MB)

    def update_mass_balance_run(self, run_id: str, updates: dict) -> Optional[dict]:
        if not updates:
            return self.get_mass_balance_run(run_id)
        set_parts = []
        values = []
        for key in ["status", "version"]:
            if key in updates:
                set_parts.append(f"{key} = ?")
                values.append(updates[key])
        for key in ["input_snapshot", "results", "overrides", "locks"]:
            if key in updates:
                set_parts.append(f"{key} = ?")
                values.append(_serialize_json(updates[key]))
        set_parts.append("updated_at = ?")
        values.append(datetime.utcnow())
        values.append(run_id)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {self._mass_balance_runs} "
                    f"SET {', '.join(set_parts)} WHERE id = ?",
                    tuple(values),
                )
                cur.execute(
                    f"SELECT * FROM {self._mass_balance_runs} WHERE id = ?",
                    (run_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_MB)

    # ========================================================================
    # CAPEX ESTIMATES
    # ========================================================================

    JSON_FIELDS_CAPEX = ["input_snapshot", "results", "overrides", "locks"]

    def get_capex_estimates_by_scenario(self, scenario_id: str) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._capex_estimates} "
                    "WHERE scenario_id = ? ORDER BY created_at DESC",
                    (scenario_id,),
                )
                rows = cur.fetchall()
                return [
                    _deserialize_fields(_row_to_dict(cur, r), self.JSON_FIELDS_CAPEX)
                    for r in rows
                ]

    def get_capex_estimate(self, estimate_id: str) -> Optional[dict]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._capex_estimates} WHERE id = ?",
                    (estimate_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_CAPEX)

    def create_capex_estimate(
        self,
        scenario_id: str,
        mass_balance_run_id: str,
        version: str = "1",
        status: str = "draft",
        input_snapshot=None,
        results=None,
        overrides=None,
        locks=None,
    ) -> dict:
        estimate_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._capex_estimates} "
                    "(id, scenario_id, mass_balance_run_id, version, status, "
                    "input_snapshot, results, overrides, locks, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        estimate_id, scenario_id, mass_balance_run_id,
                        version, status,
                        _serialize_json(input_snapshot),
                        _serialize_json(results),
                        _serialize_json(overrides),
                        _serialize_json(locks),
                        now, now,
                    ),
                )
                cur.execute(
                    f"SELECT * FROM {self._capex_estimates} WHERE id = ?",
                    (estimate_id,),
                )
                row = cur.fetchone()
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_CAPEX)

    def update_capex_estimate(self, estimate_id: str, updates: dict) -> Optional[dict]:
        if not updates:
            return self.get_capex_estimate(estimate_id)
        set_parts = []
        values = []
        for key in ["status", "version"]:
            if key in updates:
                set_parts.append(f"{key} = ?")
                values.append(updates[key])
        for key in ["input_snapshot", "results", "overrides", "locks"]:
            if key in updates:
                set_parts.append(f"{key} = ?")
                values.append(_serialize_json(updates[key]))
        set_parts.append("updated_at = ?")
        values.append(datetime.utcnow())
        values.append(estimate_id)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {self._capex_estimates} "
                    f"SET {', '.join(set_parts)} WHERE id = ?",
                    tuple(values),
                )
                cur.execute(
                    f"SELECT * FROM {self._capex_estimates} WHERE id = ?",
                    (estimate_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_CAPEX)

    # ========================================================================
    # BATCH METHODS — CapEx & Mass Balance generation context
    # Reduces DB connections from 8→2 (CapEx) and 7→2 (Mass Balance)
    # to stay safely under the 60-second Databricks Apps gateway timeout.
    # ========================================================================

    def get_capex_generation_context(self, scenario_id: str) -> dict:
        """Batch-read scenario, mass balance runs, and UPIF in a single connection."""
        with get_connection() as conn:
            with conn.cursor() as cur:
                # 1. Scenario (with project_name via JOIN)
                cur.execute(
                    f"SELECT s.*, p.name AS project_name "
                    f"FROM {self._scenarios} s "
                    f"LEFT JOIN {self._projects} p ON s.project_id = p.id "
                    "WHERE s.id = ?",
                    (scenario_id,),
                )
                row = cur.fetchone()
                scenario = (
                    _deserialize_fields(_row_to_dict(cur, row), JSON_FIELDS_SCENARIO)
                    if row else None
                )

                # 2. Mass balance runs (most recent first)
                cur.execute(
                    f"SELECT * FROM {self._mass_balance_runs} "
                    "WHERE scenario_id = ? ORDER BY created_at DESC",
                    (scenario_id,),
                )
                mb_rows = cur.fetchall()
                mb_runs = [
                    _deserialize_fields(_row_to_dict(cur, r), self.JSON_FIELDS_MB)
                    for r in mb_rows
                ]

                # 3. UPIF
                cur.execute(
                    f"SELECT * FROM {self._upif_records} WHERE scenario_id = ?",
                    (scenario_id,),
                )
                upif_row = cur.fetchone()
                upif = (
                    _deserialize_fields(_row_to_dict(cur, upif_row), JSON_FIELDS_UPIF)
                    if upif_row else None
                )

        return {
            "scenario": scenario,
            "mb_runs": mb_runs,
            "latest_mb": mb_runs[0] if mb_runs else None,
            "upif": upif,
        }

    def save_capex_estimate_with_log(
        self,
        scenario_id: str,
        mass_balance_run_id: str,
        status: str,
        input_snapshot,
        results,
        overrides,
        locks,
        # generation log fields
        document_type: str,
        model_used: str,
        duration_ms: int,
        project_id: Optional[str] = None,
        project_name: Optional[str] = None,
        scenario_name: Optional[str] = None,
        log_status: str = "success",
        error_message: Optional[str] = None,
    ) -> dict:
        """Batch: count versions + insert estimate + read back + insert log in one connection."""
        estimate_id = str(uuid.uuid4())
        log_id = str(uuid.uuid4())
        now = datetime.utcnow()

        with get_connection() as conn:
            with conn.cursor() as cur:
                # 1. Count existing versions (cheaper than fetching all rows)
                cur.execute(
                    f"SELECT COUNT(*) FROM {self._capex_estimates} WHERE scenario_id = ?",
                    (scenario_id,),
                )
                count_row = cur.fetchone()
                version = str((count_row[0] if count_row else 0) + 1)

                # 2. Insert the estimate
                cur.execute(
                    f"INSERT INTO {self._capex_estimates} "
                    "(id, scenario_id, mass_balance_run_id, version, status, "
                    "input_snapshot, results, overrides, locks, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        estimate_id, scenario_id, mass_balance_run_id,
                        version, status,
                        _serialize_json(input_snapshot),
                        _serialize_json(results),
                        _serialize_json(overrides),
                        _serialize_json(locks),
                        now, now,
                    ),
                )

                # 3. Read back the inserted estimate
                cur.execute(
                    f"SELECT * FROM {self._capex_estimates} WHERE id = ?",
                    (estimate_id,),
                )
                est_row = cur.fetchone()
                estimate = _deserialize_fields(
                    _row_to_dict(cur, est_row), self.JSON_FIELDS_CAPEX
                )

                # 4. Insert generation log
                cur.execute(
                    f"INSERT INTO {self._generation_logs} "
                    "(id, document_type, model_used, project_id, project_name, "
                    "scenario_id, scenario_name, duration_ms, status, error_message, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        log_id, document_type, model_used,
                        project_id, project_name,
                        scenario_id, scenario_name,
                        duration_ms, log_status, error_message, now,
                    ),
                )

        return estimate

    def get_mass_balance_generation_context(self, scenario_id: str) -> dict:
        """Batch-read scenario and UPIF in a single connection."""
        with get_connection() as conn:
            with conn.cursor() as cur:
                # 1. Scenario (with project_name via JOIN)
                cur.execute(
                    f"SELECT s.*, p.name AS project_name "
                    f"FROM {self._scenarios} s "
                    f"LEFT JOIN {self._projects} p ON s.project_id = p.id "
                    "WHERE s.id = ?",
                    (scenario_id,),
                )
                row = cur.fetchone()
                scenario = (
                    _deserialize_fields(_row_to_dict(cur, row), JSON_FIELDS_SCENARIO)
                    if row else None
                )

                # 2. UPIF
                cur.execute(
                    f"SELECT * FROM {self._upif_records} WHERE scenario_id = ?",
                    (scenario_id,),
                )
                upif_row = cur.fetchone()
                upif = (
                    _deserialize_fields(_row_to_dict(cur, upif_row), JSON_FIELDS_UPIF)
                    if upif_row else None
                )

        return {"scenario": scenario, "upif": upif}

    def save_mass_balance_run_with_log(
        self,
        scenario_id: str,
        status: str,
        input_snapshot,
        results,
        overrides,
        locks,
        # generation log fields
        document_type: str,
        model_used: str,
        duration_ms: int,
        project_id: Optional[str] = None,
        project_name: Optional[str] = None,
        scenario_name: Optional[str] = None,
        log_status: str = "success",
        error_message: Optional[str] = None,
    ) -> dict:
        """Batch: count versions + insert run + read back + insert log in one connection."""
        run_id = str(uuid.uuid4())
        log_id = str(uuid.uuid4())
        now = datetime.utcnow()

        with get_connection() as conn:
            with conn.cursor() as cur:
                # 1. Count existing versions
                cur.execute(
                    f"SELECT COUNT(*) FROM {self._mass_balance_runs} WHERE scenario_id = ?",
                    (scenario_id,),
                )
                count_row = cur.fetchone()
                version = str((count_row[0] if count_row else 0) + 1)

                # 2. Insert the run
                cur.execute(
                    f"INSERT INTO {self._mass_balance_runs} "
                    "(id, scenario_id, version, status, input_snapshot, results, "
                    "overrides, locks, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        run_id, scenario_id, version, status,
                        _serialize_json(input_snapshot),
                        _serialize_json(results),
                        _serialize_json(overrides),
                        _serialize_json(locks),
                        now, now,
                    ),
                )

                # 3. Read back the inserted run
                cur.execute(
                    f"SELECT * FROM {self._mass_balance_runs} WHERE id = ?",
                    (run_id,),
                )
                run_row = cur.fetchone()
                run = _deserialize_fields(
                    _row_to_dict(cur, run_row), self.JSON_FIELDS_MB
                )

                # 4. Insert generation log
                cur.execute(
                    f"INSERT INTO {self._generation_logs} "
                    "(id, document_type, model_used, project_id, project_name, "
                    "scenario_id, scenario_name, duration_ms, status, error_message, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        log_id, document_type, model_used,
                        project_id, project_name,
                        scenario_id, scenario_name,
                        duration_ms, log_status, error_message, now,
                    ),
                )

        return run

    # ========================================================================
    # GENERATION LOGS
    # ========================================================================

    def create_generation_log(
        self,
        document_type: str,
        model_used: str,
        duration_ms: int,
        status: str = "success",
        project_id: Optional[str] = None,
        project_name: Optional[str] = None,
        scenario_id: Optional[str] = None,
        scenario_name: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> dict:
        log_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._generation_logs} "
                    "(id, document_type, model_used, project_id, project_name, "
                    "scenario_id, scenario_name, duration_ms, status, error_message, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        log_id, document_type, model_used,
                        project_id, project_name,
                        scenario_id, scenario_name,
                        duration_ms, status, error_message, now,
                    ),
                )
                cur.execute(
                    f"SELECT * FROM {self._generation_logs} WHERE id = ?",
                    (log_id,),
                )
                row = cur.fetchone()
                return _row_to_dict(cur, row)

    def get_all_generation_logs(self) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._generation_logs} ORDER BY created_at DESC"
                )
                rows = cur.fetchall()
                return _rows_to_dicts(cur, rows)

    # ========================================================================
    # OPEX ESTIMATES
    # ========================================================================

    JSON_FIELDS_OPEX = ["input_snapshot", "results", "overrides", "locks"]

    def get_opex_estimates_by_scenario(self, scenario_id: str) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._opex_estimates} "
                    "WHERE scenario_id = ? ORDER BY created_at DESC",
                    (scenario_id,),
                )
                rows = cur.fetchall()
                return [
                    _deserialize_fields(_row_to_dict(cur, r), self.JSON_FIELDS_OPEX)
                    for r in rows
                ]

    def get_opex_estimate(self, estimate_id: str) -> Optional[dict]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._opex_estimates} WHERE id = ?",
                    (estimate_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_OPEX)

    def create_opex_estimate(
        self,
        scenario_id: str,
        capex_estimate_id: str,
        mass_balance_run_id: str,
        version: str = "1",
        status: str = "draft",
        input_snapshot=None,
        results=None,
        overrides=None,
        locks=None,
    ) -> dict:
        estimate_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._opex_estimates} "
                    "(id, scenario_id, capex_estimate_id, mass_balance_run_id, version, status, "
                    "input_snapshot, results, overrides, locks, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        estimate_id, scenario_id, capex_estimate_id, mass_balance_run_id,
                        version, status,
                        _serialize_json(input_snapshot),
                        _serialize_json(results),
                        _serialize_json(overrides),
                        _serialize_json(locks),
                        now, now,
                    ),
                )
                cur.execute(
                    f"SELECT * FROM {self._opex_estimates} WHERE id = ?",
                    (estimate_id,),
                )
                row = cur.fetchone()
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_OPEX)

    def update_opex_estimate(self, estimate_id: str, updates: dict) -> Optional[dict]:
        if not updates:
            return self.get_opex_estimate(estimate_id)
        set_parts = []
        values = []
        for key in ["status", "version"]:
            if key in updates:
                set_parts.append(f"{key} = ?")
                values.append(updates[key])
        for key in ["input_snapshot", "results", "overrides", "locks"]:
            if key in updates:
                set_parts.append(f"{key} = ?")
                values.append(_serialize_json(updates[key]))
        set_parts.append("updated_at = ?")
        values.append(datetime.utcnow())
        values.append(estimate_id)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {self._opex_estimates} "
                    f"SET {', '.join(set_parts)} WHERE id = ?",
                    tuple(values),
                )
                cur.execute(
                    f"SELECT * FROM {self._opex_estimates} WHERE id = ?",
                    (estimate_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_OPEX)

    # ========================================================================
    # FINANCIAL MODELS
    # ========================================================================

    JSON_FIELDS_FINANCIAL = ["assumptions", "results"]

    def get_financial_models_by_scenario(self, scenario_id: str) -> list:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._financial_models} "
                    "WHERE scenario_id = ? ORDER BY created_at DESC",
                    (scenario_id,),
                )
                rows = cur.fetchall()
                return [
                    _deserialize_fields(_row_to_dict(cur, r), self.JSON_FIELDS_FINANCIAL)
                    for r in rows
                ]

    def get_financial_model(self, model_id: str) -> Optional[dict]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM {self._financial_models} WHERE id = ?",
                    (model_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_FINANCIAL)

    def create_financial_model(
        self,
        scenario_id: str,
        mass_balance_run_id: str,
        capex_estimate_id: str,
        opex_estimate_id: str,
        version: str = "1",
        status: str = "draft",
        assumptions=None,
        results=None,
    ) -> dict:
        model_id = str(uuid.uuid4())
        now = datetime.utcnow()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {self._financial_models} "
                    "(id, scenario_id, mass_balance_run_id, capex_estimate_id, opex_estimate_id, "
                    "version, status, assumptions, results, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        model_id, scenario_id, mass_balance_run_id,
                        capex_estimate_id, opex_estimate_id,
                        version, status,
                        _serialize_json(assumptions),
                        _serialize_json(results),
                        now, now,
                    ),
                )
                cur.execute(
                    f"SELECT * FROM {self._financial_models} WHERE id = ?",
                    (model_id,),
                )
                row = cur.fetchone()
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_FINANCIAL)

    def update_financial_model(self, model_id: str, updates: dict) -> Optional[dict]:
        if not updates:
            return self.get_financial_model(model_id)
        set_parts = []
        values = []
        for key in ["status", "version"]:
            if key in updates:
                set_parts.append(f"{key} = ?")
                values.append(updates[key])
        for key in ["assumptions", "results"]:
            if key in updates:
                set_parts.append(f"{key} = ?")
                values.append(_serialize_json(updates[key]))
        set_parts.append("updated_at = ?")
        values.append(datetime.utcnow())
        values.append(model_id)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {self._financial_models} "
                    f"SET {', '.join(set_parts)} WHERE id = ?",
                    tuple(values),
                )
                cur.execute(
                    f"SELECT * FROM {self._financial_models} WHERE id = ?",
                    (model_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return _deserialize_fields(_row_to_dict(cur, row), self.JSON_FIELDS_FINANCIAL)


storage = DatabricksStorage()
