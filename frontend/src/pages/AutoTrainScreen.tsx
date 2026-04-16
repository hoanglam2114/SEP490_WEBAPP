import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useTrainingStore } from "../hooks/useTrainingStore";

const DATASET_SOURCES = [
  { value: "local", label: "Local Upload" },
  { value: "hub", label: "Hugging Face Hub" },
];

const BASE_MODEL_OPTIONS = [
  "Qwen/Qwen3-0.6B",
  "meta-llama/Llama-3.1-8B-Instruct",
  "unsloth/gpt-oss-20b",
  "unsloth/gpt-oss-20b-unsloth-bnb-4bit",
  "zai-org/GLM-4.7-Flash",
  "unsloth/GLM-4.7-Flash-GGUF",
  "stepfun-ai/Step-3.5-Flash",
  "unsloth/Qwen3-Coder-Next-GGUF",
  "lightonai/LightOnOCR-2-1B",
  "unsloth/gpt-oss-20b-GGUF",
  "Qwen/Qwen3-Coder-Next",
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4",
  "zai-org/GLM-4.7",
  "MiniMaxAI/MiniMax-M2.1",
  "sshleifer/tiny-gpt2",
];

const PARAM_LABELS: Record<
  string,
  {
    label: string;
    icon: string;
    description: string;
    type?: "number" | "text" | "select";
    options?: string[];
  }
> = {
  batchSize: {
    label: "Batch Size",
    icon: "📦",
    description: "Number of samples per batch",
  },
  epochs: {
    label: "Epochs",
    icon: "🔁",
    description: "Number of training iterations",
  },
  learningRate: {
    label: "Learning Rate",
    icon: "📈",
    description: "Step size for optimizer",
  },
  blockSize: {
    label: "Block Size",
    icon: "🧱",
    description: "Token block size for input",
  },
  modelMaxLength: {
    label: "Max Length",
    icon: "📏",
    description: "Maximum sequence length",
  },
  r: { label: "LoRA R", icon: "🔗", description: "LoRA attention dimension" },
  lora_alpha: {
    label: "LoRA Alpha",
    icon: "⚡",
    description: "Alpha parameter for LoRA scaling",
  },
  lora_dropout: {
    label: "LoRA Dropout",
    icon: "🎲",
    description: "Dropout probability for LoRA layers",
  },
  random_state: {
    label: "Random State",
    icon: "🔄",
    description: "Random state seed",
  },
  gradient_accumulation_steps: {
    label: "Grad Accum Steps",
    icon: "➕",
    description: "Steps to accumulate gradients",
  },
  warmup_steps: {
    label: "Warmup Steps",
    icon: "🔥",
    description: "Steps for learning rate warmup",
  },
  weight_decay: {
    label: "Weight Decay",
    icon: "📉",
    description: "Weight decay for AdamW",
  },
  seed: { label: "Seed", icon: "🌱", description: "Random seed for training" },
  early_stopping_loss: {
    label: "ES Loss",
    icon: "🛑",
    description: "Stop if loss < this value",
  },
  early_stopping_patience: {
    label: "ES Patience",
    icon: "⏳",
    description: "Steps to wait for loss decrease",
  },
  optim: {
    label: "Optimizer",
    icon: "🧠",
    description: "Optimizer type",
    type: "select",
    options: ["adamw_8bit", "adamw_hf", "sgd", "adafactor"],
  },
  lr_scheduler_type: {
    label: "LR Scheduler",
    icon: "⏱️",
    description: "Learning rate schedule",
    type: "select",
    options: [
      "linear",
      "cosine",
      "cosine_with_restarts",
      "polynomial",
      "constant",
      "constant_with_warmup",
    ],
  },
};

export interface TrainingMetrics {
  loss: number;
  eval_loss?: number;
  accuracy: number;
  vram: number;
  gpu_util: number;
}

export interface TrainingStatus {
  status: string;
  progress: number;
  metrics?: TrainingMetrics;
  logs?: string[];
}

export interface JobConfig {
  projectName: string;
  baseModel: string;
  datasetSource: string;
  datasetName: string;
  columnMapping: string;
  parameters: any;
  hfRepoId: string;
  hfToken: string;
}

interface WorkerInfo {
  url: string;
  vram_used_mb?: number;
  vram_total_mb?: number;
  gpu_util?: number;
  error?: string;
}

interface SystemResources {
  workers: WorkerInfo[];
  vram_used_mb: number;
  vram_total_mb: number;
  gpu_util: number;
}

export const AutoTrainScreen: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [projectName, setProjectName] = useState("");
  const [baseModel, setBaseModel] = useState(BASE_MODEL_OPTIONS[0]);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});
  const [datasetSource, setDatasetSource] = useState("local");
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [hubPath, setHubPath] = useState("");
  const [columnMapping, setColumnMapping] = useState("text");
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [hfRepoId, setHfRepoId] = useState("");
  const [hfToken, setHfToken] = useState("");

  const defaultParams = {
    batchSize: 1,
    epochs: 1,
    learningRate: 0.00003,
    blockSize: 256,
    modelMaxLength: 1024,
    r: 8,
    lora_alpha: 8,
    lora_dropout: 0.0,
    random_state: 3407,
    gradient_accumulation_steps: 4,
    warmup_steps: 5,
    weight_decay: 0.01,
    seed: 3407,
    early_stopping_loss: 0.5,
    early_stopping_patience: 100,
    optim: "adamw_8bit",
    lr_scheduler_type: "linear",
  };

  const [parameters, setParameters] =
    useState<Record<string, any>>(defaultParams);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState(
    JSON.stringify(defaultParams, null, 2),
  );
  const [showStartError, setShowStartError] = useState(false);

  // Parallel Training state
  const {
    activeJobs,
    lossHistories,
    trainingStartTimes,
    trainingStartProgress,
    eventSources
  } = useTrainingStore();

  const [showLog, setShowLog] = useState(false);
  const [systemResources, setSystemResources] =
    useState<SystemResources | null>(null);
  const logRefs = useRef<Record<string, HTMLPreElement | null>>({});
  const paramSectionRef = useRef<HTMLDivElement>(null);

  // Automatically show log if there are active jobs when component mounts
  useEffect(() => {
    if (Object.keys(activeJobs).length > 0) {
      setShowLog(true);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setLocalFile(file);
      setValidationErrors((prev) => {
        const n = { ...prev };
        delete n.dataset;
        return n;
      });
      setShowStartError(false);

      // Extract column names if file is JSON or CSV
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          if (file.name.endsWith(".json")) {
            try {
              const parsed = JSON.parse(content);
              const item = Array.isArray(parsed) ? parsed[0] : parsed;
              if (item && typeof item === "object") {
                const columns = Object.keys(item);
                setDetectedColumns(columns);
                if (columns.includes("text")) setColumnMapping("text");
                else if (columns.includes("instruction"))
                  setColumnMapping("instruction");
              }
            } catch {
              // Try JSONL if standard JSON fails
              const firstLine = content.split("\n")[0];
              try {
                const parsed = JSON.parse(firstLine);
                if (parsed && typeof parsed === "object") {
                  const columns = Object.keys(parsed);
                  setDetectedColumns(columns);
                  if (columns.includes("text")) setColumnMapping("text");
                  else if (columns.includes("instruction"))
                    setColumnMapping("instruction");
                }
              } catch { }
            }
          } else if (file.name.endsWith(".csv")) {
            const firstLine = content.split("\n")[0];
            const columns = firstLine
              .split(",")
              .map((c) => c.trim().replace(/^"|"$/g, ""));
            setDetectedColumns(columns);
            if (columns.includes("text")) setColumnMapping("text");
            else if (columns.includes("instruction"))
              setColumnMapping("instruction");
          }
        } catch (err) {
          console.error("Error parsing columns:", err);
        }
      };
      // Read first 10KB to extract headers
      reader.readAsText(file.slice(0, 10240));
    }
  };

  const handleJsonModeToggle = () => {
    if (!jsonMode) {
      setJsonText(JSON.stringify(parameters, null, 2));
    } else {
      try {
        const parsed = JSON.parse(jsonText);
        const paramKeys = Object.keys(PARAM_LABELS);
        const newErrors: Record<string, string> = {};
        for (const key of paramKeys) {
          const type = PARAM_LABELS[key]?.type;
          if (
            type !== "text" &&
            type !== "select" &&
            parsed[key] !== undefined &&
            typeof parsed[key] === "number" &&
            parsed[key] < 0
          ) {
            newErrors[key] =
              `${PARAM_LABELS[key]?.label || key} must be 0 or greater`;
          }
        }
        setValidationErrors((prev) => {
          const cleaned = { ...prev };
          for (const key of paramKeys) delete cleaned[key];
          return { ...cleaned, ...newErrors };
        });
        setParameters(parsed);
      } catch { }
    }
    setJsonMode((v) => !v);
  };

  const handleParamChange = (key: string, value: string | number) => {
    const newParams = { ...parameters, [key]: value };
    setParameters(newParams);
    setJsonText(JSON.stringify(newParams, null, 2));

    const type = PARAM_LABELS[key]?.type;
    if (
      type !== "text" &&
      type !== "select" &&
      typeof value === "number" &&
      value < 0
    ) {
      setValidationErrors((prev) => ({
        ...prev,
        [key]: `${PARAM_LABELS[key]?.label || key} must be 0 or greater`,
      }));
    } else {
      setValidationErrors((prev) => {
        const n = { ...prev };
        delete n[key];
        return n;
      });
    }
  };

  const handleJsonTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonText(e.target.value);
    try {
      const parsed = JSON.parse(e.target.value);
      const paramKeys = Object.keys(PARAM_LABELS);
      const errors: Record<string, string> = {};
      for (const key of paramKeys) {
        const type = PARAM_LABELS[key]?.type;
        if (
          type !== "text" &&
          type !== "select" &&
          parsed[key] !== undefined &&
          typeof parsed[key] === "number" &&
          parsed[key] < 0
        ) {
          errors[key] =
            `${PARAM_LABELS[key]?.label || key} must be 0 or greater`;
        }
      }
      // Preserve non-param errors (like projectName, baseModel)
      setValidationErrors((prev) => {
        const cleaned: Record<string, string> = {};
        for (const k of Object.keys(prev)) {
          if (!paramKeys.includes(k)) cleaned[k] = prev[k];
        }
        return { ...cleaned, ...errors };
      });
      if (Object.keys(errors).length === 0) {
        setParameters(parsed);
      }
    } catch { }
  };

  // Auto-scroll log to bottom for each active job
  useEffect(() => {
    Object.keys(activeJobs).forEach((id) => {
      const ref = logRefs.current[id];
      if (ref) {
        ref.scrollTop = ref.scrollHeight;
      }
    });
  }, [activeJobs]);

  // Handle Resume from TrainingHistoryScreen
  useEffect(() => {
    const state = location.state as
      | { resumeJobId?: string; jobId?: string }
      | null;
    const resumeId = state?.resumeJobId || state?.jobId;
    if (!resumeId) return;

    window.history.replaceState({}, document.title);

    const hydrateAndTrack = async () => {
      try {
        const res = await fetch(`/api/train/history/${resumeId}`);
        const data = await res.json();

        if (res.ok && data) {
          const mergedParams = {
            ...defaultParams,
            ...(data.parameters || {}),
          };

          setProjectName(typeof data.projectName === "string" ? data.projectName : "");
          setBaseModel(typeof data.baseModel === "string" ? data.baseModel : BASE_MODEL_OPTIONS[0]);
          setDatasetSource(typeof data.datasetSource === "string" ? data.datasetSource : "local");
          setHubPath(typeof data.datasetSource === "string" && data.datasetSource === "hub" && typeof data.datasetName === "string" ? data.datasetName : "");
          setLocalFile(null);
          setDetectedColumns([]);
          setColumnMapping(typeof data.columnMapping === "string" ? data.columnMapping : "text");
          setParameters(mergedParams);
          setJsonText(JSON.stringify(mergedParams, null, 2));
          setHfRepoId(typeof data.hfRepoId === "string" ? data.hfRepoId : "");

          const jobConfig: JobConfig = {
            projectName: typeof data.projectName === "string" ? data.projectName : "AutoTrain Job",
            baseModel: typeof data.baseModel === "string" ? data.baseModel : BASE_MODEL_OPTIONS[0],
            datasetSource: typeof data.datasetSource === "string" ? data.datasetSource : "local",
            datasetName: typeof data.datasetName === "string" ? data.datasetName : "",
            columnMapping: typeof data.columnMapping === "string" ? data.columnMapping : "text",
            parameters: mergedParams,
            hfRepoId: typeof data.hfRepoId === "string" ? data.hfRepoId : "",
            hfToken: "",
          };

          startTrackingJob(resumeId, jobConfig);
          return;
        }
      } catch { }

      startTrackingJob(resumeId);
    };

    hydrateAndTrack();
  }, [location.state]);

  const startTrackingJob = (jobId: string, config?: JobConfig) => {
    const store = useTrainingStore.getState();
    if (store.eventSources[jobId]) return;

    if (config) {
      store.setJobConfig(jobId, config);
    }

    setShowLog(true);
    store.addJob(jobId, config || store.jobConfigs[jobId]);

    const es = new EventSource(`/api/train/stream/${jobId}`);
    store.setEventSource(jobId, es);

    es.onmessage = (event) => {
      try {
        const status: TrainingStatus = JSON.parse(event.data);
        useTrainingStore.getState().updateJobStatus(jobId, status);

        if (status.metrics && typeof status.metrics.loss === "number") {
          useTrainingStore.getState().updateLossHistory(jobId, status.progress || 0, status.metrics.loss);
        }

        if (status.metrics && typeof status.metrics.eval_loss === "number") {
          useTrainingStore.getState().updateEvalLossHistory(jobId, status.progress || 0, status.metrics.eval_loss);
        }

        if (
          status.status === "COMPLETED" ||
          status.status === "STOPPED" ||
          status.status === "FAILED" ||
          status.status === "ERROR"
        ) {
          useTrainingStore.getState().closeEventSource(jobId);

          const currentStore = useTrainingStore.getState();
          const jobConfig = currentStore.jobConfigs[jobId];
          if (jobConfig) {
            const completedAt = new Date();
            const startedAt = currentStore.trainingStartTimes[jobId] || new Date();
            const trainingDuration = completedAt.getTime() - startedAt.getTime();
            const logs = status.logs || [];
            const lastLogLine = logs.length > 0 ? logs[logs.length - 1] : "";

            fetch("/api/train/history", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobId,
                ...jobConfig,
                status: status.status,
                finalMetrics: status.metrics,
                lastLogLine,
                trainingDuration,
                startedAt: startedAt.toISOString(),
                completedAt: completedAt.toISOString(),
              }),
            })
              .then((r) => r.json())
              .then((d) => console.log("[AutoTrain] History updated:", d.message))
              .catch((e) => console.error("[AutoTrain] Failed to update history:", e));
          }
        }
      } catch { }
    };

    es.addEventListener("end", () => {
      useTrainingStore.getState().closeEventSource(jobId);
    });

    es.onerror = () => {
      useTrainingStore.getState().closeEventSource(jobId);
    };
  };

  // Cleanup SSE on unmount
  useEffect(() => {
    const fetchResources = async () => {
      try {
        const response = await fetch("/api/system/resources");
        const data = await response.json();
        setSystemResources(data);
      } catch { }
    };

    fetchResources();
    const interval = setInterval(fetchResources, 5000);

    return () => {
      clearInterval(interval);
      // Removed closing EventSources here so they persist in the store
    };
  }, []);

  const hasParamErrors = (): boolean => {
    const paramKeys = Object.keys(PARAM_LABELS);
    return paramKeys.some((k) => validationErrors[k]);
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!projectName.trim()) errors.projectName = "Project Name is required";
    if (!baseModel) errors.baseModel = "Base Model is required";
    // Validate dataset
    if (datasetSource === "local" && !localFile) {
      errors.dataset = "Please upload a training data file (.json or .csv)";
    } else if (datasetSource === "hub" && !hubPath.trim()) {
      errors.dataset = "Please enter a Hugging Face Hub dataset path";
    }
    const paramKeys = Object.keys(PARAM_LABELS);
    for (const key of paramKeys) {
      const type = PARAM_LABELS[key]?.type;
      if (
        type !== "text" &&
        type !== "select" &&
        (parameters[key] === undefined ||
          parameters[key] === null ||
          parameters[key] < 0)
      ) {
        errors[key] = `${PARAM_LABELS[key]?.label || key} must be 0 or greater`;
      }
    }

    setValidationErrors(errors);

    // validate Hugging Face parameters (always required now)
    if (!hfToken.trim()) {
      errors.hfToken = "Hugging Face Access Token is required";
    }
    if (!hfRepoId.trim()) {
      errors.hfRepoId = "Hugging Face Repository ID is required";
    }

    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      setShowStartError(true);
      // Scroll to param section if there are param errors
      const hasParamErr = paramKeys.some((k) => errors[k]);
      if (hasParamErr && paramSectionRef.current) {
        paramSectionRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }

    return Object.keys(errors).length === 0;
  };

  const handleStartTraining = async () => {
    if (!validateForm()) return;

    setShowStartError(false);

    try {
      const formData = new FormData();
      formData.append("model_name", baseModel);
      formData.append("push_to_hub", "true");
      formData.append("hf_repo_id", hfRepoId);
      formData.append("hf_token", hfToken);

      const paramKeys = Object.keys(PARAM_LABELS);
      for (const key of paramKeys) {
        if (parameters[key] !== undefined) {
          formData.append(key, parameters[key].toString());
        }
      }

      if (datasetSource === "local" && localFile) {
        formData.append("dataset_file", localFile);
      } else {
        formData.append("dataset", hubPath);
      }

      // Append metadata explicitly for initial TrainingHistory creation Backend-side
      formData.append("projectName", projectName);
      formData.append("datasetSource", datasetSource);
      formData.append("columnMapping", columnMapping);
      formData.append("column_mapping", columnMapping); // Also send snake_case just in case

      const response = await fetch("/api/train/start", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        let errorMsg = data.error || "Failed to start training";
        if (errorMsg.includes("'text'") || errorMsg.includes("'instruction'")) {
          errorMsg = `Column Mapping Error: The column ${errorMsg} was not found in your dataset. Please check the 'Column Mapping' field.`;
        }
        alert(errorMsg);
        return;
      }

      const newJobId = data.job_id;
      const jobConfig: JobConfig = {
        projectName,
        baseModel,
        datasetSource,
        datasetName:
          datasetSource === "local" && localFile ? localFile.name : hubPath,
        columnMapping,
        parameters,
        hfRepoId,
        hfToken,
      };
      startTrackingJob(newJobId, jobConfig);
    } catch (err: any) {
      alert(err.message || "Error starting training");
    }
  };

  const handleStopTraining = async (jobId: string) => {
    try {
      await fetch(`/api/train/stop/${jobId}`, { method: "POST" });
      const store = useTrainingStore.getState();
      store.closeEventSource(jobId);
      store.updateJobStatus(jobId, { ...store.activeJobs[jobId], status: "STOPPED" });
    } catch { }
  };

  const statusConfig: Record<
    string,
    { bg: string; text: string; dot: string }
  > = {
    QUEUED: {
      bg: "bg-yellow-50 border-yellow-200",
      text: "text-yellow-700",
      dot: "bg-yellow-400",
    },
    PENDING: {
      bg: "bg-amber-50 border-amber-200",
      text: "text-amber-700",
      dot: "bg-amber-400",
    },
    LOADING_MODEL: {
      bg: "bg-blue-50 border-blue-200",
      text: "text-blue-700",
      dot: "bg-blue-400 animate-pulse",
    },
    TRAINING: {
      bg: "bg-emerald-50 border-emerald-200",
      text: "text-emerald-700",
      dot: "bg-emerald-400 animate-pulse",
    },
    COMPLETED: {
      bg: "bg-emerald-50 border-emerald-200",
      text: "text-emerald-700",
      dot: "bg-emerald-500",
    },
    STOPPED: {
      bg: "bg-red-50 border-red-200",
      text: "text-red-700",
      dot: "bg-red-400",
    },
  };

  const getStatusStyle = (status?: string) =>
    statusConfig[status ?? ""] ?? {
      bg: "bg-gray-50 border-gray-200",
      text: "text-gray-600",
      dot: "bg-gray-400",
    };

  const errorCount = Object.keys(validationErrors).length;
  const isAnyJobTraining = Object.values(activeJobs).some((job) =>
    ["RUNNING", "PENDING", "QUEUED", "LOADING_MODEL", "TRAINING"].includes(
      job.status,
    ),
  );
  const activeJobCount = Object.keys(eventSources).length;

  const getChartData = (id: string) => {
    const trainingHistory = lossHistories[id] || [];
    const evaluationHistory = (useTrainingStore.getState().evalLossHistories || {})[id] || [];

    // Ghép 2 mảng theo progress
    const combined: Record<number, { progress: number; loss?: number; eval_loss?: number }> = {};

    trainingHistory.forEach(item => {
      combined[item.progress] = { ...combined[item.progress], progress: item.progress, loss: item.loss };
    });

    evaluationHistory.forEach(item => {
      combined[item.progress] = { ...combined[item.progress], progress: item.progress, eval_loss: item.loss };
    });

    return Object.values(combined).sort((a, b) => a.progress - b.progress);
  };

  const calculateETA = (jobId: string, progress: number) => {
    if (!progress || progress <= 0 || progress >= 100) return null;
    const startTime = trainingStartTimes[jobId];
    const startProgress = trainingStartProgress[jobId] || 0;
    if (!startTime) return null;

    const now = new Date();
    const elapsedMs = now.getTime() - new Date(startTime).getTime();

    // Calculate progress gained since this session started
    const progressGained = progress - startProgress;

    // Need at least some progress to make an estimation
    if (progressGained <= 0.5) return null;

    const remainingProgress = 100 - progress;
    const estimatedRemainingMs = (elapsedMs / progressGained) * remainingProgress;

    if (estimatedRemainingMs <= 0) return null;

    const seconds = Math.floor((estimatedRemainingMs / 1000) % 60);
    const minutes = Math.floor((estimatedRemainingMs / (1000 * 60)) % 60);
    const hours = Math.floor(estimatedRemainingMs / (1000 * 60 * 60));

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
              title="Back to Home"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <span className="text-2xl">🚀</span> AutoTrain
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure and train your model
              </p>
            </div>
          </div>
          {isAnyJobTraining && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-full">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-emerald-700">
                {activeJobCount} Training in progress
              </span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/model-eval/run")}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 rounded-xl text-sm font-semibold transition-all"
              title="Go to Model Evaluation"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Evaluation
            </button>
            <button
              onClick={() => navigate("/training-history")}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-medium transition-all"
              title="View Training History"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              History
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Top banner if there are validation errors when start pressed */}
        {showStartError && errorCount > 0 && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 animate-shake">
            <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
              <svg
                className="w-5 h-5 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-red-800 text-sm">
                Cannot start training — please fix the following errors:
              </h3>
              <ul className="mt-1.5 space-y-0.5">
                {Object.entries(validationErrors).map(([key, msg]) => (
                  <li
                    key={key}
                    className="text-red-600 text-xs flex items-center gap-1.5"
                  >
                    <span className="w-1 h-1 rounded-full bg-red-400" />
                    {msg}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => setShowStartError(false)}
              className="ml-auto flex-shrink-0 text-red-400 hover:text-red-600 transition"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Left: Project Config (3 cols) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Project Info Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                <h2 className="font-semibold text-slate-700 flex items-center gap-2">
                  <span className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center text-sm">
                    📋
                  </span>
                  Project Configuration
                </h2>
              </div>
              <div className="p-6 space-y-5">
                {/* Project Name */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Project Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    className={`w-full border rounded-xl px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 ${validationErrors.projectName
                        ? "border-red-300 bg-red-50 focus:ring-red-200 text-red-800 placeholder-red-300"
                        : "border-slate-200 bg-white focus:ring-blue-200 focus:border-blue-400"
                      }`}
                    value={projectName}
                    onChange={(e) => {
                      setProjectName(e.target.value);
                      setValidationErrors((prev) => {
                        const n = { ...prev };
                        delete n.projectName;
                        return n;
                      });
                      setShowStartError(false);
                    }}
                    placeholder="e.g. my-finetune-project"
                  />
                  {validationErrors.projectName && (
                    <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1">
                      <svg
                        className="w-3 h-3"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {validationErrors.projectName}
                    </p>
                  )}
                </div>

                {/* Base Model */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Base Model <span className="text-red-400">*</span>
                  </label>
                  <select
                    className={`w-full border rounded-xl px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 appearance-none bg-white ${validationErrors.baseModel
                        ? "border-red-300 bg-red-50 focus:ring-red-200"
                        : "border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                      }`}
                    value={baseModel}
                    onChange={(e) => setBaseModel(e.target.value)}
                  >
                    {BASE_MODEL_OPTIONS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Dataset Source */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Dataset Source
                    </label>
                    <select
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 appearance-none bg-white transition-all"
                      value={datasetSource}
                      onChange={(e) => {
                        setDatasetSource(e.target.value);
                        if (e.target.value === "hub") {
                          setDetectedColumns([]);
                          setLocalFile(null);
                        }
                      }}
                    >
                      {DATASET_SOURCES.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Column Mapping */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Column Mapping
                    </label>
                    <div className="flex flex-col gap-2">
                      <input
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition-all"
                        value={columnMapping}
                        onChange={(e) => setColumnMapping(e.target.value)}
                        placeholder="e.g. text"
                      />
                      {detectedColumns.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mr-1">
                            Detected:
                          </span>
                          {detectedColumns.map((col) => (
                            <button
                              key={col}
                              onClick={() => setColumnMapping(col)}
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${columnMapping === col
                                  ? "bg-blue-100 text-blue-700 border border-blue-200"
                                  : "bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200"
                                }`}
                            >
                              {col}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Training Data / Hub Path */}
                {datasetSource === "local" ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Training Data <span className="text-red-400">*</span>
                    </label>
                    <label
                      className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-xl cursor-pointer transition-all group ${validationErrors.dataset
                          ? "border-red-300 bg-red-50/30 hover:border-red-400"
                          : "border-slate-200 hover:border-blue-400 hover:bg-blue-50/30"
                        }`}
                    >
                      <div
                        className={`flex flex-col items-center ${validationErrors.dataset
                            ? "text-red-400 group-hover:text-red-500"
                            : "text-slate-400 group-hover:text-blue-500"
                          }`}
                      >
                        <svg
                          className="w-6 h-6 mb-1"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                          />
                        </svg>
                        <span className="text-xs font-medium">
                          {localFile
                            ? localFile.name
                            : "Click to upload .json or .csv"}
                        </span>
                      </div>
                      <input
                        type="file"
                        accept=".json,.csv"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                    {localFile && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-1.5">
                        <svg
                          className="w-3.5 h-3.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {localFile.name} ({(localFile.size / 1024).toFixed(1)}{" "}
                        KB)
                      </div>
                    )}
                    {validationErrors.dataset && (
                      <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1">
                        <svg
                          className="w-3 h-3"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {validationErrors.dataset}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Hub Dataset Path <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                        🤗
                      </span>
                      <input
                        className={`w-full border rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all ${validationErrors.dataset
                            ? "border-red-300 bg-red-50 focus:ring-red-200 text-red-800 placeholder-red-300"
                            : "border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                          }`}
                        value={hubPath}
                        onChange={(e) => {
                          setHubPath(e.target.value);
                          setValidationErrors((prev) => {
                            const n = { ...prev };
                            delete n.dataset;
                            return n;
                          });
                          setShowStartError(false);
                        }}
                        placeholder="e.g. abhishek/dataset"
                      />
                    </div>
                    {validationErrors.dataset && (
                      <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1">
                        <svg
                          className="w-3 h-3"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {validationErrors.dataset}
                      </p>
                    )}
                  </div>
                )}

                {/* Hugging Face Settings (Always Visible) */}
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        HF Access Token <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                          🔑
                        </span>
                        <input
                          type="password"
                          className={`w-full border rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all ${validationErrors.hfToken
                              ? "border-red-300 bg-red-50 focus:ring-red-200 text-red-800 placeholder-red-300"
                              : "border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                            }`}
                          value={hfToken}
                          onChange={(e) => {
                            setHfToken(e.target.value);
                            setValidationErrors((prev) => {
                              const n = { ...prev };
                              delete n.hfToken;
                              return n;
                            });
                            setShowStartError(false);
                          }}
                          placeholder="hf_..."
                        />
                      </div>
                      {validationErrors.hfToken && (
                        <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1">
                          <svg
                            className="w-3 h-3"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                          {validationErrors.hfToken}
                        </p>
                      )}
                    </div>

                    <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Target Repository ID{" "}
                        <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                          🤗
                        </span>
                        <input
                          className={`w-full border rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all ${validationErrors.hfRepoId
                              ? "border-red-300 bg-red-50 focus:ring-red-200 text-red-800 placeholder-red-300"
                              : "border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                            }`}
                          value={hfRepoId}
                          onChange={(e) => {
                            setHfRepoId(e.target.value);
                            setValidationErrors((prev) => {
                              const n = { ...prev };
                              delete n.hfRepoId;
                              return n;
                            });
                            setShowStartError(false);
                          }}
                          placeholder="e.g. username/my-model"
                        />
                      </div>
                      {validationErrors.hfRepoId && (
                        <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1">
                          <svg
                            className="w-3 h-3"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                          {validationErrors.hfRepoId}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Parameters (2 cols) */}
          <div className="lg:col-span-2 space-y-6" ref={paramSectionRef}>
            {/* System Resources (Colab Workers) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-700 flex items-center gap-2 text-sm">
                  <span className="w-6 h-6 bg-amber-100 rounded-lg flex items-center justify-center text-xs">
                    🖥️
                  </span>
                  Colab Workers Status
                </h2>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-slate-400 font-medium">
                    Live
                  </span>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {systemResources?.workers ? (
                  systemResources.workers.map((worker, idx) => (
                    <div
                      key={worker.url}
                      className="bg-slate-50 border border-slate-100 rounded-xl p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-700">
                            Worker {idx + 1}
                          </span>
                          {worker.error ? (
                            <span className="text-[10px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                              Offline
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                              Online
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-slate-400 font-mono truncate max-w-[120px]">
                          {worker.url}
                        </span>
                      </div>
                      {!worker.error && (
                        <div className="grid grid-cols-2 gap-3 mt-1">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[9px] text-slate-400">
                                GPU Load
                              </span>
                              <span className="text-[9px] font-bold text-slate-600">
                                {worker.gpu_util}%
                              </span>
                            </div>
                            <div className="w-full bg-slate-200 rounded-full h-1 overflow-hidden">
                              <div
                                className="bg-blue-500 h-1 transition-all"
                                style={{ width: `${worker.gpu_util}%` }}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[9px] text-slate-400">
                                VRAM
                              </span>
                              <span className="text-[9px] font-bold text-slate-600">
                                {worker.vram_used_mb}MB
                              </span>
                            </div>
                            <div className="w-full bg-slate-200 rounded-full h-1 overflow-hidden">
                              <div
                                className="bg-purple-500 h-1 transition-all"
                                style={{
                                  width: `${((worker.vram_used_mb || 0) / (worker.vram_total_mb || 1)) * 100}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center">
                    <div className="w-8 h-8 border-2 border-blue-100 border-t-blue-500 rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-[10px] text-slate-400">
                      Connecting to Colab workers...
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-700 flex items-center gap-2">
                  <span className="w-7 h-7 bg-purple-100 rounded-lg flex items-center justify-center text-sm">
                    ⚙️
                  </span>
                  Parameters
                </h2>
                <button
                  onClick={handleJsonModeToggle}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${jsonMode
                      ? "bg-purple-100 text-purple-700 hover:bg-purple-200"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                    />
                  </svg>
                  {jsonMode ? "Form View" : "JSON View"}
                </button>
              </div>

              <div className="p-6">
                {!jsonMode ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {Object.entries(PARAM_LABELS).map(([key, meta]) => {
                      const hasError = !!validationErrors[key];
                      const value = parameters[key as keyof typeof parameters];
                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                              <span className="text-xs">{meta.icon}</span>{" "}
                              {meta.label}
                            </label>
                            <span className="text-[10px] text-slate-400">
                              {meta.description}
                            </span>
                          </div>
                          {meta.type === "select" ? (
                            <select
                              className={`w-full border rounded-xl px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 appearance-none bg-white ${hasError
                                  ? "border-red-300 bg-red-50 focus:ring-red-200 text-red-700"
                                  : "border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                                }`}
                              value={value}
                              onChange={(e) =>
                                handleParamChange(key, e.target.value)
                              }
                            >
                              {meta.options?.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : meta.type === "text" ? (
                            <input
                              type="text"
                              className={`w-full border rounded-xl px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 ${hasError
                                  ? "border-red-300 bg-red-50 focus:ring-red-200 text-red-700"
                                  : "border-slate-200 bg-white focus:ring-blue-200 focus:border-blue-400"
                                }`}
                              value={value}
                              onChange={(e) =>
                                handleParamChange(key, e.target.value)
                              }
                            />
                          ) : (
                            <input
                              type="number"
                              step={
                                key === "learningRate"
                                  ? 0.00001
                                  : key === "lora_dropout" ||
                                    key === "weight_decay"
                                    ? 0.01
                                    : 1
                              }
                              className={`w-full border rounded-xl px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 ${hasError
                                  ? "border-red-300 bg-red-50 focus:ring-red-200 text-red-700"
                                  : "border-slate-200 bg-white focus:ring-blue-200 focus:border-blue-400"
                                }`}
                              value={value}
                              onChange={(e) =>
                                handleParamChange(key, Number(e.target.value))
                              }
                            />
                          )}
                          {hasError && (
                            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">
                              <svg
                                className="w-3.5 h-3.5 flex-shrink-0"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              {validationErrors[key]}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div>
                    <textarea
                      className={`w-full h-72 border rounded-xl px-4 py-3 font-mono text-xs leading-relaxed transition-all focus:outline-none focus:ring-2 ${hasParamErrors()
                          ? "border-red-300 bg-red-50/50 focus:ring-red-200"
                          : "border-slate-200 bg-slate-50 focus:ring-blue-200 focus:border-blue-400"
                        }`}
                      value={jsonText}
                      onChange={handleJsonTextChange}
                      spellCheck={false}
                    />
                    {hasParamErrors() && (
                      <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3 space-y-1">
                        <div className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                          <svg
                            className="w-3.5 h-3.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                          Invalid parameter values:
                        </div>
                        {Object.entries(validationErrors)
                          .filter(([k]) =>
                            Object.keys(PARAM_LABELS).includes(k),
                          )
                          .map(([key, msg]) => (
                            <p key={key} className="text-xs text-red-600 ml-5">
                              • {msg}
                            </p>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <button
                className={`w-full py-4 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-sm ${activeJobCount >= 3
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                    : "bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 hover:shadow-md active:scale-[0.98]"
                  }`}
                onClick={handleStartTraining}
                disabled={activeJobCount >= 3}
              >
                {activeJobCount >= 3 ? (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                    Workers Busy (Max 3)
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    Start New Training Job
                  </>
                )}
              </button>
              <p className="text-[10px] text-center text-slate-400">
                You can run up to 3 models simultaneously across 3 Colab
                instances.
              </p>
            </div>
          </div>
        </div>

        {/* Parallel Training Progress Panels */}
        {showLog && Object.entries(activeJobs).length > 0 && (
          <div className="mt-8 space-y-6">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 px-2">
              <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-sm">
                🔄
              </span>
              Active Training Jobs ({Object.keys(activeJobs).length})
            </h2>

            <div className="grid grid-cols-1 gap-6">
              {Object.entries(activeJobs).map(([id, status]) => {
                const s = getStatusStyle(status.status);
                const isFinished = [
                  "COMPLETED",
                  "STOPPED",
                  "FAILED",
                  "ERROR",
                ].includes(status.status);

                return (
                  <div
                    key={id}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500"
                  >
                    {/* Panel Header */}
                    <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center text-sm">
                          📊
                        </span>
                        <div>
                          <h3 className="font-semibold text-slate-700 text-sm">
                            Job: {id}
                          </h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.bg} ${s.text}`}
                            >
                              <span
                                className={`w-1 h-1 rounded-full ${s.dot}`}
                              />
                              {status.status}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isFinished && (
                          <button
                            onClick={() => handleStopTraining(id)}
                            className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-100 rounded-lg text-xs font-bold hover:bg-red-100 transition-all flex items-center gap-1.5"
                          >
                            <svg
                              className="w-3 h-3"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
                                clipRule="evenodd"
                              />
                            </svg>
                            Stop Job
                          </button>
                        )}
                        <button
                          onClick={() => {
                            useTrainingStore.getState().removeJob(id);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                      {/* Left: Progress & Metrics */}
                      <div className="p-6 border-r border-slate-100">
                        <div className="mb-6">
                          <div className="flex items-center justify-between text-sm mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 font-medium">
                                Training Progress
                              </span>
                              {status.status === "TRAINING" && (
                                <span className="text-[10px] text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                  <svg
                                    className="w-3 h-3 animate-spin"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                  >
                                    <circle
                                      className="opacity-25"
                                      cx="12"
                                      cy="12"
                                      r="10"
                                      stroke="currentColor"
                                      strokeWidth="4"
                                    />
                                    <path
                                      className="opacity-75"
                                      fill="currentColor"
                                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                    />
                                  </svg>
                                  ETA: {calculateETA(id, status.progress) || "Calculating..."}
                                </span>
                              )}
                            </div>
                            <span className="font-bold text-slate-700">
                              {status.progress ?? 0}%
                            </span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                            <div
                              className={`h-2.5 rounded-full transition-all duration-700 ease-out ${status.status === "COMPLETED"
                                  ? "bg-emerald-500"
                                  : status.status === "STOPPED"
                                    ? "bg-red-500"
                                    : "bg-blue-600 animate-pulse"
                                }`}
                              style={{ width: `${status.progress ?? 0}%` }}
                            />
                          </div>
                        </div>

                        {status.metrics && (
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                            <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3">
                              <div className="text-[10px] text-blue-500 font-bold uppercase mb-0.5">
                                Train Loss
                              </div>
                              <div className="text-lg font-bold text-blue-700 font-mono">
                                {status.metrics?.loss.toFixed(4)}
                              </div>
                            </div>
                            <div className="bg-rose-50/50 border border-rose-100 rounded-xl p-3">
                              <div className="text-[10px] text-rose-500 font-bold uppercase mb-0.5 flex items-center gap-1">
                                Eval Loss
                                <span className="group relative">
                                  <span className="cursor-help text-rose-400">ⓘ</span>
                                  <span className="invisible group-hover:visible absolute left-0 bottom-full mb-2 w-48 p-2 bg-slate-800 text-white text-[9px] rounded-lg leading-tight z-50">
                                    Validation Loss: Độ lỗi trên tập dữ liệu kiểm tra. Nếu tăng dần là dấu hiệu Overfit.
                                  </span>
                                </span>
                              </div>
                              <div className="text-lg font-bold text-rose-700 font-mono">
                                {status.metrics?.eval_loss?.toFixed(4) || "---"}
                              </div>
                            </div>
                            <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3">
                              <div className="text-[10px] text-amber-500 font-bold uppercase mb-0.5">
                                Overfit Gap
                              </div>
                              <div className={`text-lg font-bold font-mono ${status.metrics?.eval_loss && status.metrics?.loss
                                  ? (status.metrics.eval_loss - status.metrics.loss) > 0.5 ? "text-red-600" : "text-amber-700"
                                  : "text-slate-400"
                                }`}>
                                {status.metrics?.eval_loss && status.metrics?.loss
                                  ? (status.metrics.eval_loss - status.metrics.loss).toFixed(4)
                                  : "0.0000"}
                              </div>
                            </div>
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                              <div className="text-[10px] text-slate-400 font-medium mb-0.5">
                                Accuracy
                              </div>
                              <div className="text-lg font-bold text-slate-700">
                                {status.metrics?.accuracy}%
                              </div>
                            </div>
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                              <div className="text-[10px] text-slate-400 font-medium mb-0.5">
                                VRAM
                              </div>
                              <div className="text-lg font-bold text-slate-700">
                                {status.metrics?.vram} MB
                              </div>
                            </div>
                          </div>
                        )}
                        {lossHistories[id] && lossHistories[id].length > 0 && (
                          <div className="bg-white border border-slate-100 rounded-xl p-3 h-40">
                            <div className="text-[10px] text-slate-400 font-medium mb-2 flex items-center gap-4">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-0.5 bg-blue-500 rounded" /> Training Loss
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-0.5 bg-rose-500 rounded" /> Eval Loss (Overfit)
                              </span>
                            </div>
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={getChartData(id)}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis
                                  dataKey="progress"
                                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                                  tickFormatter={(value) => `${value}%`}
                                />
                                <YAxis
                                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                                  domain={['auto', 'auto']}
                                />
                                <Tooltip
                                  contentStyle={{ fontSize: '10px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                  labelFormatter={(value) => `Progress: ${value}%`}
                                />
                                <Line
                                  type="monotone"
                                  dataKey="loss"
                                  stroke="#3b82f6"
                                  strokeWidth={2}
                                  dot={false}
                                  activeDot={{ r: 4 }}
                                  connectNulls
                                />
                                <Line
                                  type="monotone"
                                  dataKey="eval_loss"
                                  stroke="#f43f5e"
                                  strokeWidth={2}
                                  dot={{ r: 3, fill: '#f43f5e' }}
                                  activeDot={{ r: 5 }}
                                  connectNulls
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>

                      {/* Right: Logs */}
                      <div className="bg-slate-900 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Console Output
                          </span>
                          <span className="text-[10px] text-slate-600 font-mono">
                            job_id: {id.slice(-8)}
                          </span>
                        </div>
                        <pre
                          ref={(el) => (logRefs.current[id] = el)}
                          className="text-emerald-400 h-48 overflow-y-auto text-[10px] font-mono leading-relaxed custom-scrollbar"
                        >
                          {status.status === "QUEUED"
                            ? "\n$ Job is queued and waiting for an available Colab worker...\n"
                            : status.logs?.join("\n") ||
                            "$ Initializing connection to worker..."}
                        </pre>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.5s ease-in-out; }
      `}</style>
    </div>
  );
};
