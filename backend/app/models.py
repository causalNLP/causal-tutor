from typing import List, Optional
from pydantic import BaseModel, Field

class CitedParagraph(BaseModel):
    page: int
    text: str
    aspect: str = Field(description="The aspect being cited, e.g., 'method_selection' or 'result_justification'")

class AlternativeMethod(BaseModel):
    method_name: str = Field(description="Name of an alternative method that could have been used")
    feasibility: str = Field(description="Why this method applies or why it was rejected (e.g., 'Requires longitudinal data which is missing')")
    trade_off: str = Field(description="Pros/Cons compared to the chosen method")

class MethodAnalysis(BaseModel):
    method_name: str = Field(description="The identified causal method (e.g., Difference-in-Differences, Instrumental Variables)")
    method_selection_summary: str = Field(description="Explanation of why this method was chosen and its validity")
    assumptions: List[str] = Field(description="Key assumptions required for this method (e.g., 'Parallel Trends', 'Exclusion Restriction')")
    critique: str = Field(description="A critical evaluation of the method's application. Are there potential threats to validity? (e.g., 'Weak instrument', 'Violation of SUTVA')")
    result_justification_summary: str = Field(description="Summary of the causal results and their robustness")
    cited_paragraphs: List[CitedParagraph] = Field(description="List of paragraphs from the text supporting the analysis")

class CausalQueryResponse(BaseModel):
    paper_name: str
    causal_query: str = Field(description="The core causal question being investigated")
    causal_graph_mermaid: str = Field(description="Mermaid.js graph definition. Use 'graph LR'. Represent unobserved confounders with dashed styles.")
    methods: List[MethodAnalysis] = Field(description="List of methods identified and analyzed in the paper")
    alternative_methods: List[AlternativeMethod] = Field(description="List of 2-3 alternative methods that could be applicable to this research question")
    suggested_questions: List[str] = Field(description="3-4 educational follow-up questions for a student")

class DatasetSchema(BaseModel):
    headers: List[str]
    types: List[str]
    sample_rows: List[dict]

class ResearchProject(BaseModel):
    rq_text: str
    pdf_text: Optional[str] = None
    dataset_schema: Optional[DatasetSchema] = None
    analysis: Optional[CausalQueryResponse] = None

class ExamQuestion(BaseModel):
    question_text: str
    options: List[str]
    correct_option_index: int
    explanation: str

class ExamResponse(BaseModel):
    method_name: str
    questions: List[ExamQuestion]

class APIAnalysisResponse(BaseModel):
    analysis: CausalQueryResponse
    full_text: str
    # Set for PDF uploads: the original file, so follow-up chat turns can pass it
    # straight to the LLM instead of re-using extracted text.
    pdf_base64: Optional[str] = None
    pdf_filename: Optional[str] = None

class AnalyzeTextRequest(BaseModel):
    text: str
    scenario_name: str = "User Scenario"

class ChatRequest(BaseModel):
    paper_text: str
    analysis_context: str
    messages: List[dict]
    model: str = "gpt-4o"
