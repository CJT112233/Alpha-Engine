"""
Pydantic models matching the TypeScript schema from shared/schema.ts.
These define the data shapes for API request/response validation.
"""
from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None

class Project(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None


class ScenarioCreate(BaseModel):
    project_id: str = Field(alias="projectId")
    name: str
    status: str = "draft"
    preferred_model: str = Field(default="databricks-gpt-5-2", alias="preferredModel")

    model_config = {"populate_by_name": True}

class Scenario(BaseModel):
    id: str
    project_id: str
    name: str
    status: str = "draft"
    preferred_model: Optional[str] = "databricks-gpt-5-2"
    clarifying_questions: Optional[Any] = None
    clarifying_answers: Optional[Any] = None
    created_at: Optional[datetime] = None
    confirmed_at: Optional[datetime] = None
    project_name: Optional[str] = None


class TextEntryCreate(BaseModel):
    scenario_id: str = Field(alias="scenarioId")
    content: str
    category: Optional[str] = None

    model_config = {"populate_by_name": True}

class TextEntry(BaseModel):
    id: str
    scenario_id: str
    content: str
    category: Optional[str] = None
    created_at: Optional[datetime] = None


class DocumentCreate(BaseModel):
    scenario_id: str
    filename: str
    original_name: str
    mime_type: str
    size: str
    extracted_text: Optional[str] = None

class Document(BaseModel):
    id: str
    scenario_id: str
    filename: str
    original_name: str
    mime_type: str
    size: str
    extracted_text: Optional[str] = None
    created_at: Optional[datetime] = None


class ParameterCreate(BaseModel):
    scenario_id: str = Field(alias="scenarioId")
    category: str
    name: str
    value: Optional[str] = None
    unit: Optional[str] = None
    source: str
    confidence: Optional[str] = None
    is_confirmed: bool = False

    model_config = {"populate_by_name": True}

class ExtractedParameter(BaseModel):
    id: str
    scenario_id: str
    category: str
    name: str
    value: Optional[str] = None
    unit: Optional[str] = None
    source: str
    confidence: Optional[str] = None
    is_confirmed: bool = False
    created_at: Optional[datetime] = None


class EnrichedFeedstockSpec(BaseModel):
    value: str
    unit: str
    source: str
    confidence: str
    provenance: str
    group: str
    displayName: str
    sortOrder: int

class FeedstockEntry(BaseModel):
    feedstockType: str
    feedstockVolume: Optional[str] = None
    feedstockUnit: Optional[str] = None
    feedstockParameters: Optional[dict] = None
    feedstockSpecs: Optional[dict] = None

class UpifCreate(BaseModel):
    scenario_id: str
    feedstock_type: Optional[str] = None
    feedstock_volume: Optional[str] = None
    feedstock_unit: Optional[str] = None
    feedstock_parameters: Optional[dict] = None
    feedstock_specs: Optional[dict] = None
    feedstocks: Optional[list] = None
    output_requirements: Optional[str] = None
    output_specs: Optional[dict] = None
    location: Optional[str] = None
    constraints: Optional[list] = None
    confirmed_fields: Optional[dict] = None
    is_confirmed: bool = False

class UpifRecord(BaseModel):
    id: str
    scenario_id: str
    feedstock_type: Optional[str] = None
    feedstock_volume: Optional[str] = None
    feedstock_unit: Optional[str] = None
    feedstock_parameters: Optional[Any] = None
    feedstock_specs: Optional[Any] = None
    feedstocks: Optional[Any] = None
    output_requirements: Optional[str] = None
    output_specs: Optional[Any] = None
    location: Optional[str] = None
    constraints: Optional[Any] = None
    confirmed_fields: Optional[Any] = None
    is_confirmed: bool = False
    confirmed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ChatMessageCreate(BaseModel):
    scenario_id: str
    role: str
    content: str
    applied_updates: Optional[dict] = None

class UpifChatMessage(BaseModel):
    id: str
    scenario_id: str
    role: str
    content: str
    applied_updates: Optional[Any] = None
    created_at: Optional[datetime] = None


class PromptTemplateUpdate(BaseModel):
    template: str

class PromptTemplate(BaseModel):
    id: Optional[str] = None
    key: str
    name: str
    description: Optional[str] = None
    template: str
    is_system_prompt: bool = True
    updated_at: Optional[datetime] = None
