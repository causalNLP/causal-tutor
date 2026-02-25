import io
import os
import json
import pandas as pd
from typing import List, Optional
from fastapi import UploadFile
from pypdf import PdfReader
from openai import AsyncOpenAI
from dotenv import load_dotenv
from .models import CausalQueryResponse, DatasetSchema, ExamResponse, ExamQuestion

# Load environment variables FIRST, before initializing the client
load_dotenv()

# Initialize client with key from environment (or explicit fallback if needed for debugging)
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    # Fallback to check if it's set in the system environment variables (outside .env file)
    print("Warning: OPENAI_API_KEY not found in .env or environment variables.")

client = AsyncOpenAI(api_key=api_key)

async def generate_single_question(method_name: str) -> ExamQuestion:
    prompt = f"""Generate exactly 1 high-quality multiple-choice exam question to test a student's understanding of the causal method: {method_name}.
    
    Focus on:
    1. Identification assumptions.
    2. Threats to validity.
    3. Interpretation of results.
    
    Return a JSON object with the question details."""
    
    tools = [
        {
            "type": "function",
            "function": {
                "name": "provide_exam_question",
                "description": "Generates a single exam question.",
                "parameters": ExamQuestion.model_json_schema()
            }
        }
    ]
    
    completion = await client.chat.completions.create(
        model="gpt-4o-mini", # Fallback to gpt-4o-mini due to SDK versioning issues with gpt-5
        messages=[{"role": "user", "content": prompt}],
        tools=tools,
        tool_choice={"type": "function", "function": {"name": "provide_exam_question"}}
    )
    
    tool_call = completion.choices[0].message.tool_calls[0]
    return ExamQuestion(**json.loads(tool_call.function.arguments))

async def generate_exam_questions(method_name: str, num_questions: int = 15) -> ExamResponse:
    # Use asyncio.gather to generate questions in parallel
    import asyncio
    
    # We generate num_questions (default 15) in parallel
    tasks = [generate_single_question(method_name) for _ in range(num_questions)]
    questions = await asyncio.gather(*tasks)
    
    return ExamResponse(
        method_name=method_name,
        questions=list(questions)
    )

async def extract_csv_schema(file: UploadFile) -> DatasetSchema:
    contents = await file.read()
    # Read first 5 rows to get schema and sample
    df = pd.read_csv(io.BytesIO(contents), nrows=5)
    
    headers = df.columns.tolist()
    types = [str(t) for t in df.dtypes.tolist()]
    # Convert samples to dict, handling NaNs
    sample_rows = df.where(pd.notnull(df), None).to_dict(orient='records')
    
    return DatasetSchema(
        headers=headers,
        types=types,
        sample_rows=sample_rows
    )

async def extract_text_from_pdf(file: UploadFile) -> str:
    contents = await file.read()
    pdf_file = io.BytesIO(contents)
    reader = PdfReader(pdf_file)
    
    full_text = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text:
            full_text.append(f"--- PAGE {i+1} ---\n{text}")
            
    return "\n".join(full_text)

SYSTEM_PROMPT = """You are an expert Causal Inference Scientist and Tutor. Your goal is to analyze research papers or scenarios to explain their causal methodology to graduate students.

You must go beyond simple summarization. You must CRITIQUE the study design and evaluate ALTERNATIVES.

Focus on:
1. **Core Causal Query**: What is $D \rightarrow Y$?
2. **Method Identification**: (DiD, IV, RDD, Propensity Score, etc.)
3. **Assumptions & Validity**: 
   - Explicitly list assumptions (e.g., Parallel Trends, Exclusion Restriction).
   - **CRITIQUE**: Does the paper convince you these hold? Are there unobserved confounders? (e.g., "The authors control for X, but Z is likely an unobserved confounder.")
4. **Alternative Methods**: What other methods *could* have been used? Why is the chosen one better (or worse)?
5. **Causal Graph (DAG)**:
   - Generate a Mermaid.js 'graph LR'.
   - Use standard notation: 
     - Observed nodes: `A[Name]`
     - Unobserved/Latent nodes: `U((Unobserved))` (use circles)
     - Causal paths: `A --> B`
     - Biasing paths (dashed): `U -.-> A`
   - Ensure the DAG represents the *identification strategy* (e.g., in IV, show Z -> D -> Y and U -> D, U -> Y).

6. **Educational Questions**: Socratic questions to test the student's understanding of the *design*.

CITATION RULES:
- If analyzing a PDF, extract exact quotes and page numbers for every claim.
- If analyzing a user-provided scenario (no page numbers), use page=0 and paraphrase.

Return the output in the specified JSON structure.
"""

async def analyze_paper(text: str, filename: str) -> CausalQueryResponse:
    tools = [
        {
            "type": "function",
            "function": {
                "name": "provide_causal_analysis",
                "description": "Extracts causal methodology, critique, alternatives, and generates a DAG.",
                "parameters": CausalQueryResponse.model_json_schema()
            }
        }
    ]
    
    completion = await client.chat.completions.create(
        model="gpt-4o", # Fallback to gpt-4o due to SDK versioning issues with gpt-5
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Analyze the following text/paper: {filename}\n\n{text[:100000]}"} 
        ],
        tools=tools,
        tool_choice={"type": "function", "function": {"name": "provide_causal_analysis"}}
    )
    
    tool_call = completion.choices[0].message.tool_calls[0]
    return CausalQueryResponse(**json.loads(tool_call.function.arguments))

async def chat_with_paper(paper_text: str, analysis_context: Optional[str], messages: List[dict], model: str = "gpt-4o"):
    system_prompt_content = f"""You are a helpful and Socratic Causal Tutor. Your goal is to help students understand the causal inference methods used in the provided research paper or scenario.

Current Analysis Context:
{analysis_context if analysis_context else "No prior analysis available."}

---

Reference Context:
{paper_text[:50000]}...

---

Instructions for Tutor:
1. **Be Socratic**: Don't just give answers. Ask "Why do you think..." or "What would happen if...".
2. **Focus on Identification**: When asked about results, first explain *how* they identified the effect.
3. **Math & Intuition**: Use LaTeX for math (e.g., $Y_{{it}} = \\alpha + \\beta D_{{it}} + \\epsilon_{{it}}$). Explain the intuition *before* the math.
4. **Critique**: Encourage the student to find flaws. "Do you believe the exclusion restriction holds here?"
5. **DAGs**: Refer to the Causal Graph in your explanations.
"""
    
    formatted_messages = [
        {"role": "system", "content": system_prompt_content}
    ] 
    
    for m in messages:
        if m["role"] in ["user", "assistant"]:
            formatted_messages.append({"role": m["role"], "content": m["content"]})
    
    completion = await client.chat.completions.create(
        model=model, # Fallback to gpt-4o
        messages=formatted_messages,
        stream=True
    )
    return completion
