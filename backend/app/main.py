from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from pydantic import BaseModel
import os
from dotenv import load_dotenv

from .models import CausalQueryResponse, ChatRequest, APIAnalysisResponse, AnalyzeTextRequest, ResearchProject, ExamResponse
from .services import analyze_paper, extract_text_from_pdf, extract_csv_schema, chat_with_paper, generate_exam_questions
from .curriculum_data import CURRICULUM_METHODS
from .dag_models import (
    DAGValidateRequest, DAGValidateResponse,
    DSeparationRequest, DSeparationResponse,
    PathsRequest, PathsResponse,
    DAGAnalyzeRequest, DAGAnalyzeResponse,
    DAGChatRequest,
)
from .dag_services import validate_dag, check_d_separation, find_all_paths, analyze_dag_with_gpt, chat_about_dag
from .sandbox_models import (
    QueriesResponse, DatasetPreview,
    EstimateRequest, EstimateResponse,
    InterpretRequest,
)
from .sandbox_services import (
    load_queries, preview_dataset, estimate as sandbox_estimate,
    interpret_result,
)

load_dotenv()

app = FastAPI(title="Causal Tutor API", description="AI-powered causal inference tutor")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for simplicity in dev, restrict in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Causal Tutor API is running"}

@app.get("/curriculum-methods")
async def get_curriculum_methods():
    return CURRICULUM_METHODS

@app.post("/generate-exam", response_model=ExamResponse)
async def generate_exam_endpoint(method_name: str, num_questions: int = 5):
    try:
        exam = await generate_exam_questions(method_name, num_questions)
        return exam
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/analyze-project")
async def analyze_project_endpoint(
    rq_text: str = Form(...),
    pdf_file: Optional[UploadFile] = File(None),
    csv_file: Optional[UploadFile] = File(None)
):
    try:
        # 1. Process PDF if present
        pdf_text = None
        if pdf_file and pdf_file.filename.endswith(".pdf"):
            pdf_text = await extract_text_from_pdf(pdf_file)
        
        # 2. Process CSV if present
        dataset_schema = None
        if csv_file and csv_file.filename.endswith(".csv"):
            dataset_schema = await extract_csv_schema(csv_file)
            
        # 3. Construct Synthesis Prompt for Analysis
        # We combine RQ + PDF Text + Dataset Schema into one context
        synthesis_text = f"Research Question: {rq_text}\n\n"
        
        if dataset_schema:
            synthesis_text += f"Available Dataset Schema:\nHeaders: {dataset_schema.headers}\nSample Data: {dataset_schema.sample_rows}\n\n"
            
        if pdf_text:
            synthesis_text += f"Reference Paper Content:\n{pdf_text[:50000]}" # Limit context
        
        # 4. Run Analysis
        analysis = await analyze_paper(synthesis_text, "Research Design Project")
        
        return {
            "project": {
                "rq_text": rq_text,
                "pdf_text": pdf_text,
                "dataset_schema": dataset_schema,
                "analysis": analysis
            },
            "analysis": analysis,
            "full_text": synthesis_text
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/analyze", response_model=APIAnalysisResponse)
async def analyze_endpoint(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    
    try:
        # Extract text
        text = await extract_text_from_pdf(file)
        
        # Analyze with LLM
        # We pass the text to the analysis service
        analysis = await analyze_paper(text, file.filename)
        
        # Return both analysis and full text for frontend context
        return APIAnalysisResponse(analysis=analysis, full_text=text)
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/analyze-scenario", response_model=APIAnalysisResponse)
async def analyze_scenario_endpoint(request: AnalyzeTextRequest):
    try:
        # Analyze text directly
        analysis = await analyze_paper(request.text, request.scenario_name)
        return APIAnalysisResponse(analysis=analysis, full_text=request.text)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

class ChatInput(BaseModel):
    message: str
    history: List[dict]
    paper_text: str
    analysis_context: Optional[str] = None # Added for context

@app.post("/chat")
async def chat_endpoint(request: ChatInput):
    # This endpoint streams the response
    try:
        # Format history for OpenAI
        # We assume history is a list of {"role": "user"/"assistant", "content": "..."}
        messages = request.history + [{"role": "user", "content": request.message}]
        
        async def generate():
            stream = await chat_with_paper(request.paper_text, request.analysis_context, messages)
            async for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    yield content

        return StreamingResponse(generate(), media_type="text/event-stream")

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── DAG Playground Endpoints ──────────────────────────────────────────────

@app.post("/dag/validate", response_model=DAGValidateResponse)
async def dag_validate(request: DAGValidateRequest):
    try:
        return validate_dag(request.graph)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/dag/d-separation", response_model=DSeparationResponse)
async def dag_d_separation(request: DSeparationRequest):
    try:
        return check_d_separation(request.graph, request.node_a, request.node_b, request.conditioning_set)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/dag/paths", response_model=PathsResponse)
async def dag_paths(request: PathsRequest):
    try:
        return find_all_paths(request.graph, request.source, request.target)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/dag/analyze", response_model=DAGAnalyzeResponse)
async def dag_analyze(request: DAGAnalyzeRequest):
    try:
        return await analyze_dag_with_gpt(request.graph, request.research_question)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/dag/chat")
async def dag_chat(request: DAGChatRequest):
    try:
        async def generate():
            stream = await chat_about_dag(
                request.graph,
                request.history + [{"role": "user", "content": request.message}],
            )
            async for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    yield content

        return StreamingResponse(generate(), media_type="text/event-stream")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── Dataset Sandbox Endpoints ─────────────────────────────────────────────

@app.get("/sandbox/queries", response_model=QueriesResponse)
async def sandbox_queries():
    try:
        return QueriesResponse(queries=load_queries())
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sandbox/dataset", response_model=DatasetPreview)
async def sandbox_dataset(id: str, limit: int = 50):
    try:
        return preview_dataset(id, limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sandbox/estimate", response_model=EstimateResponse)
async def sandbox_estimate_endpoint(request: EstimateRequest):
    try:
        return sandbox_estimate(request.id, request.method, request.variables)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sandbox/interpret")
async def sandbox_interpret(request: InterpretRequest):
    try:
        async def generate():
            stream = await interpret_result(request)
            async for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    yield content

        return StreamingResponse(generate(), media_type="text/event-stream")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
