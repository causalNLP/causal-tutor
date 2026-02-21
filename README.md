# Causal Tutor

An advanced AI-powered research assistant designed to act as a **Causal AI Scientist**. It helps graduate students and domain researchers (Econ, Public Health, BME) rigorously understand, critique, and apply causal inference methods.

![Causal Tutor UI](https://via.placeholder.com/1200x675.png?text=Causal+Tutor+Dashboard)

## 🎯 Objective

Unlike generic chatbots, **Causal Tutor** focuses on the scientific rigor of research design. It doesn't just summarize papers; it:
*   **Visualizes** identification strategies using Causal DAGs (Directed Acyclic Graphs).
*   **Critiques** methodologies by identifying threats to validity (e.g., unobserved confounders).
*   **Suggests Alternatives** to foster critical thinking about research design trade-offs.
*   **Cites Evidence** with exact page numbers to ensure trustworthiness.

## 🚀 Features

*   **📄 Deep Paper Analysis:** Upload a PDF to get a structured breakdown of the Causal Query, Assumptions (e.g., Parallel Trends), and Robustness Checks.
*   **📊 Causal Graph Generation:** Automatically generates interactive Mermaid.js DAGs to visualize $Treatment \rightarrow Outcome$ paths and confounders.
*   **⚠️ Critique & Alternatives:** Proactively identifies weaknesses in the study design and suggests alternative methods (e.g., "Why DiD instead of Synthetic Control?").
*   **💬 Socratic Tutor Chat:** An interactive chat that uses LaTeX math support and Socratic questioning to teach *why* a method works, not just *how*.
*   **🧠 Scenario Simulation:** Describe a hypothetical research idea (e.g., "I want to study the effect of X on Y"), and the AI will design the study for you.

## 🛠️ Tech Stack

*   **Backend:** Python (FastAPI), OpenAI GPT-4o, PyPDF, Pydantic
*   **Frontend:** TypeScript (Next.js 14), Tailwind CSS, Lucide Icons
*   **Visualization:** Mermaid.js (DAGs), KaTeX (Math Rendering)
*   **Infrastructure:** Docker Compose

## 🏁 Getting Started

### Prerequisites
*   Docker & Docker Compose
*   OpenAI API Key

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/causal-tutor.git
    cd causal-tutor
    ```

2.  **Set up Environment:**
    Create a `.env` file in the root directory:
    ```bash
    OPENAI_API_KEY=sk-your-key-here
    ```

3.  **Run with Docker (Recommended):**
    ```bash
    docker-compose up --build
    ```

4.  **Access the App:**
    *   **Frontend:** [http://localhost:3000](http://localhost:3000)
    *   **Backend Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

### Local Development (No Docker)

If you prefer running locally without containers:

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## 📂 Project Structure

```
CausalTutor/
├── backend/                # FastAPI Application
│   ├── app/
│   │   ├── services.py     # AI Logic (Critique, DAG Generation)
│   │   ├── models.py       # Pydantic Schemas
│   │   └── main.py         # API Endpoints
├── frontend/               # Next.js Application
│   ├── src/components/     # UI Components (Chat, MermaidChart)
│   ├── src/types/          # TS Interfaces
```

## 🤝 Contribution

This project is designed for university-level causality courses. Contributions to improve the "Socratic" capabilities or add new causal methods (e.g., Bartik Instruments, Shift-Share) are welcome.
