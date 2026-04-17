"use client";

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import type {
  SandboxQuery,
  SandboxDatasetPreview,
  VariableSelection,
  EstimateResponse,
} from "@/types";
import QueryGallery from "./sandbox/QueryGallery";
import AnalysisView from "./sandbox/AnalysisView";

export default function DatasetSandbox() {
  const [queries, setQueries] = useState<SandboxQuery[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dataset, setDataset] = useState<SandboxDatasetPreview | null>(null);
  const [method, setMethod] = useState<string>("ols");
  const [vars, setVars] = useState<VariableSelection>({
    treatment: "",
    outcome: "",
    controls: [],
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [interpretation, setInterpretation] = useState<string>("");
  const [loadingQuery, setLoadingQuery] = useState(false);

  const selectedQuery = queries.find((q) => q.id === selectedId) || null;

  // Load queries once
  useEffect(() => {
    axios
      .get<{ queries: SandboxQuery[] }>("http://localhost:8000/sandbox/queries")
      .then((res) => setQueries(res.data.queries))
      .catch((err) => console.error("Failed to load queries", err));
  }, []);

  // When a query is selected, fetch dataset and prefill vars
  useEffect(() => {
    if (!selectedId) return;
    const q = queries.find((x) => x.id === selectedId);
    if (!q) return;

    setLoadingQuery(true);
    setDataset(null);
    setResult(null);
    setInterpretation("");

    axios
      .get<SandboxDatasetPreview>(
        `http://localhost:8000/sandbox/dataset?id=${selectedId}&limit=50`
      )
      .then((res) => {
        setDataset(res.data);
        setMethod(q.method);
        setVars({
          treatment: q.treatment_var,
          outcome: q.outcome_var,
          controls: q.control_variables,
          instrument: q.instrument_var,
          running_var: q.running_var,
          cutoff: q.cutoff,
          temporal_var: q.temporal_var,
          state_var: q.state_var,
          mediator: q.mediator_var,
        });
      })
      .catch((err) => console.error("Failed to load dataset", err))
      .finally(() => setLoadingQuery(false));
  }, [selectedId, queries]);

  const handleRun = useCallback(async () => {
    if (!selectedQuery || !dataset) return;
    setRunning(true);
    setResult(null);
    setInterpretation("");

    try {
      const res = await axios.post<EstimateResponse>(
        "http://localhost:8000/sandbox/estimate",
        { id: selectedQuery.id, method, variables: vars }
      );
      setResult(res.data);

      // Only stream interpretation if we have a real estimate
      if (res.data.estimate !== null) {
        const response = await fetch("http://localhost:8000/sandbox/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            result: res.data,
            query: selectedQuery.query,
            dataset_description: selectedQuery.dataset_description,
          }),
        });
        if (!response.body) throw new Error("No response body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value);
          setInterpretation(acc);
        }
      }
    } catch (err) {
      console.error("Estimation failed", err);
    } finally {
      setRunning(false);
    }
  }, [selectedQuery, dataset, method, vars]);

  const handleBack = useCallback(() => {
    setSelectedId(null);
    setDataset(null);
    setResult(null);
    setInterpretation("");
  }, []);

  const handleResetVars = useCallback(() => {
    if (!selectedQuery) return;
    setMethod(selectedQuery.method);
    setVars({
      treatment: selectedQuery.treatment_var,
      outcome: selectedQuery.outcome_var,
      controls: selectedQuery.control_variables,
      instrument: selectedQuery.instrument_var,
      running_var: selectedQuery.running_var,
      cutoff: selectedQuery.cutoff,
      temporal_var: selectedQuery.temporal_var,
      state_var: selectedQuery.state_var,
      mediator: selectedQuery.mediator_var,
    });
    setResult(null);
    setInterpretation("");
  }, [selectedQuery]);

  if (!selectedId || !selectedQuery) {
    return <QueryGallery queries={queries} onPick={setSelectedId} />;
  }

  return (
    <AnalysisView
      query={selectedQuery}
      dataset={dataset}
      loadingDataset={loadingQuery}
      method={method}
      vars={vars}
      result={result}
      interpretation={interpretation}
      running={running}
      onBack={handleBack}
      onRun={handleRun}
      onReset={handleResetVars}
      onMethodChange={setMethod}
      onVarsChange={setVars}
    />
  );
}
