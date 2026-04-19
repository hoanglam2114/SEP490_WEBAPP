import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { apiService } from "../services/api";
import {
    Menu, Plus, MessageSquare, MoreVertical,
    Sparkles, ChevronUp,
    RotateCcw, Send, ArrowLeft, CheckCircle2,
    Loader2, SplitSquareHorizontal, MonitorSmartphone,
    AlertCircle, Settings2
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
    role: "user" | "ai";
    content: string;
    responseTime?: number;
    model?: string;
    parameters?: any;
}

interface LogEntry {
    ts: number;
    instanceId?: number;
    message: string;
    type: "info" | "success" | "error" | "warning";
    data?: any;
}

type ChatMode = "select" | "single" | "compare";

// ─── Inference Params ─────────────────────────────────────────────────────────

interface InferenceParams {
    systemPrompt: string;
    maxNewTokens: number | "";
    temperature: number | "";
    topK: number | "";
    topP: number | "";
    repetitionPenalty: number | "";
}

const DEFAULT_PARAMS: InferenceParams = {
    systemPrompt: "",
    maxNewTokens: 512,
    temperature: 0.7,
    topK: 50,
    topP: 0.95,
    repetitionPenalty: 1.1,
};

// ─── Markdown Renderer ────────────────────────────────────────────────────────

const MarkdownRenderer = ({ content }: { content: string }) => (
    <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
            strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
            em: ({ children }) => <em className="italic text-slate-700">{children}</em>,
            code: ({ inline, children, ...props }: any) =>
                inline ? (
                    <code className="bg-slate-100 text-rose-500 px-1.5 py-0.5 rounded-md text-[13px] font-mono">
                        {children}
                    </code>
                ) : (
                    <pre className="bg-slate-900 text-slate-100 rounded-xl p-4 overflow-x-auto my-3 text-[13px] font-mono leading-relaxed">
                        <code {...props}>{children}</code>
                    </pre>
                ),
            h1: ({ children }) => <h1 className="text-xl font-bold text-slate-900 mt-4 mb-2">{children}</h1>,
            h2: ({ children }) => <h2 className="text-lg font-semibold text-slate-900 mt-3 mb-1.5">{children}</h2>,
            h3: ({ children }) => <h3 className="text-base font-semibold text-slate-800 mt-2 mb-1">{children}</h3>,
            ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-slate-700">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-slate-700">{children}</ol>,
            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
            blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-slate-300 pl-4 italic text-slate-500 my-3">{children}</blockquote>
            ),
            table: ({ children }) => (
                <div className="overflow-x-auto my-3">
                    <table className="border-collapse w-full text-sm">{children}</table>
                </div>
            ),
            th: ({ children }) => <th className="border border-slate-200 bg-slate-50 px-3 py-1.5 text-left font-semibold text-slate-700">{children}</th>,
            td: ({ children }) => <td className="border border-slate-200 px-3 py-1.5 text-slate-600">{children}</td>,
            p: ({ children }) => <p className="leading-relaxed mb-2 last:mb-0 text-slate-700">{children}</p>,
            hr: () => <hr className="my-4 border-slate-200" />,
        }}
    >
        {content}
    </ReactMarkdown>
);

// ─── Params Summary Bar ───────────────────────────────────────────────────────

function ParamsSummaryBar({ params, onToggleLogs, showLogsActive }: { params: InferenceParams, onToggleLogs?: () => void, showLogsActive?: boolean }) {
    const chips = [
        { label: "Tokens", value: params.maxNewTokens },
        { label: "Temp", value: params.temperature },
        { label: "Top-K", value: params.topK },
        { label: "Top-P", value: params.topP },
        { label: "Rep", value: params.repetitionPenalty },
    ];
    return (
        <div className="flex items-center gap-1.5 flex-wrap px-1 pb-1.5">
            {chips.map(({ label, value }) => (
                <span
                    key={label}
                    className="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 rounded-full"
                >
                    <span className="text-slate-400">{label}</span>
                    <span className="text-slate-700 font-semibold">{value === "" ? "–" : String(value)}</span>
                </span>
            ))}
            {params.systemPrompt && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-violet-50 text-violet-500 border border-violet-200 px-2 py-0.5 rounded-full max-w-[160px]">
                    <span className="text-violet-400">Sys</span>
                    <span className="truncate text-violet-700 font-semibold">{params.systemPrompt}</span>
                </span>
            )}
            {onToggleLogs && (
                <button
                    onClick={onToggleLogs}
                    className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border transition-all whitespace-nowrap ml-1
                        ${showLogsActive
                            ? "bg-slate-800 text-white border-slate-800"
                            : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100"}`}
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                    Logs
                </button>
            )}
        </div>
    );
}

// ─── Global Logs Panel ────────────────────────────────────────────────────────

function GlobalLogsPanel({ logs, onClose }: { logs: LogEntry[], onClose: () => void }) {
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    return (
        <div className="absolute bottom-full left-0 right-0 mb-3 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-4 z-50 flex flex-col h-64 text-slate-300 font-mono text-[12px] overflow-hidden" style={{ boxShadow: "0 -10px 40px -10px rgba(0,0,0,0.5)" }}>
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-700/80 shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="font-bold text-slate-100 uppercase tracking-widest text-[11px]">Inference Logs Console</span>
                </div>
                <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white">
                    <ChevronUp size={14} className="rotate-180" />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 scroll-smooth" style={{ scrollbarWidth: "thin", scrollbarColor: "#475569 transparent" }}>
                {logs.length === 0 ? (
                    <div className="text-slate-500 italic flex h-full items-center justify-center">Chưa có log...</div>
                ) : (
                    logs.map((L, i) => (
                        <div key={i} className="flex gap-2.5 items-start leading-relaxed">
                            <span className="text-slate-500 shrink-0 select-none">[{new Date(L.ts).toLocaleTimeString()}]</span>
                            {L.instanceId && <span className="text-violet-400 font-semibold shrink-0 select-none">[Model {L.instanceId}]</span>}
                            <div className={`flex-1 min-w-0 ${L.type === 'error' ? 'text-red-400' :
                                L.type === 'success' ? 'text-emerald-400' :
                                    L.type === 'warning' ? 'text-amber-400' : 'text-slate-300'
                                }`}>
                                <p className="break-words">{L.message}</p>
                                {L.data && (
                                    <pre className="text-[10px] mt-1.5 p-2 bg-slate-950/50 rounded-lg text-slate-400 overflow-x-auto whitespace-pre-wrap word-break">
                                        {JSON.stringify(L.data, null, 2)}
                                    </pre>
                                )}
                            </div>
                        </div>
                    ))
                )}
                <div ref={endRef} />
            </div>
        </div>
    );
}

// ─── Params Dropdown Panel ────────────────────────────────────────────────────

function ParamsDropdown({
    params,
    onChange,
    onClose,
}: {
    params: InferenceParams;
    onChange: (p: InferenceParams) => void;
    onClose: () => void;
}) {
    const fields: { key: keyof InferenceParams; label: string; placeholder: string; step?: number; type: "number" | "text" }[] = [
        { key: "maxNewTokens", label: "Max Tokens", placeholder: "512", type: "number" },
        { key: "temperature", label: "Temperature", placeholder: "0.7", step: 0.1, type: "number" },
        { key: "topK", label: "Top K", placeholder: "50", type: "number" },
        { key: "topP", label: "Top P", placeholder: "0.95", step: 0.05, type: "number" },
        { key: "repetitionPenalty", label: "Repetition Penalty", placeholder: "1.1", step: 0.1, type: "number" },
    ];

    const set = (key: keyof InferenceParams, raw: string) => {
        const val = raw === "" ? "" : Number(raw);
        onChange({ ...params, [key]: val });
    };

    return (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-80 bg-white border border-slate-200 rounded-2xl shadow-lg shadow-slate-200/60 p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] font-bold text-slate-700 uppercase tracking-widest">Tham số Inference</span>
                <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-700">
                    <ChevronUp size={14} />
                </button>
            </div>

            {/* Number fields — 2 cols */}
            <div className="grid grid-cols-2 gap-2 mb-3">
                {fields.map(({ key, label, placeholder, step }) => (
                    <div key={key} className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-slate-400 ml-0.5">{label}</label>
                        <input
                            type="number"
                            step={step}
                            placeholder={placeholder}
                            value={params[key]}
                            onChange={(e) => set(key, e.target.value)}
                            className="bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-lg px-2.5 py-1.5 text-[13px] outline-none transition-all"
                        />
                    </div>
                ))}
            </div>

            {/* System prompt */}
            <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-slate-400 ml-0.5">System Prompt</label>
                <textarea
                    placeholder="Nhập hướng dẫn cho AI..."
                    value={params.systemPrompt}
                    onChange={(e) => onChange({ ...params, systemPrompt: e.target.value })}
                    className="bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-lg px-3 py-2 text-[13px] outline-none transition-all resize-none h-16"
                />
            </div>
        </div>
    );
}

// ─── Mode Selection Screen ────────────────────────────────────────────────────

function ModeSelectScreen({ onSelect }: { onSelect: (mode: "single" | "compare") => void }) {
    const navigate = useNavigate();
    const [hovered, setHovered] = useState<string | null>(null);

    const modes = [
        {
            id: "single",
            title: "Single Model",
            description: "Chat với một model duy nhất. Tải model và bắt đầu hội thoại.",
            tag: "Standard",
            tagColor: "bg-amber-50 text-amber-600 border-amber-200",
            icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
            ),
        },
        {
            id: "compare",
            title: "Compare 2 Models",
            description: "Gửi cùng một câu hỏi cho 2 model, xem song song để so sánh kết quả trực quan.",
            tag: "Comparison",
            tagColor: "bg-violet-50 text-violet-600 border-violet-200",
            icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
            ),
        },
    ];

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* Top bar */}
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => navigate("/")}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 hover:text-slate-800"
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 bg-slate-800 rounded-lg flex items-center justify-center">
                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                            </div>
                            <span className="text-sm font-bold text-slate-800 tracking-tight">Chatbot Training Toolkit</span>
                        </div>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">AI Chatbot</span>
                </div>
            </header>

            {/* Content */}
            <div className="max-w-3xl mx-auto px-6 pt-14 pb-10 w-full">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Inference</p>
                <h1 className="text-4xl font-bold text-slate-900 leading-tight mb-2">
                    Chọn chế độ<br />
                    <span className="text-slate-400">chat.</span>
                </h1>
                <p className="mt-3 text-slate-500 text-base max-w-md mb-10">
                    Chạy một model đơn, hoặc so sánh đồng thời hai model để đánh giá chất lượng.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {modes.map((mode) => {
                        const isHovered = hovered === mode.id;
                        return (
                            <button
                                key={mode.id}
                                onClick={() => onSelect(mode.id as "single" | "compare")}
                                onMouseEnter={() => setHovered(mode.id)}
                                onMouseLeave={() => setHovered(null)}
                                className={`group text-left bg-white border rounded-2xl p-6 transition-all duration-200 cursor-pointer
                                    ${isHovered
                                        ? "border-slate-800 shadow-md shadow-slate-200"
                                        : "border-slate-200 shadow-sm"
                                    }`}
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className={`p-2.5 rounded-xl border transition-colors duration-200
                                        ${isHovered ? "bg-slate-800 border-slate-800 text-white" : "bg-slate-50 border-slate-200 text-slate-500"}`}>
                                        {mode.icon}
                                    </div>
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${mode.tagColor}`}>
                                        {mode.tag}
                                    </span>
                                </div>
                                <h2 className="text-sm font-bold text-slate-800 mb-1.5">{mode.title}</h2>
                                <p className="text-xs text-slate-400 leading-relaxed">{mode.description}</p>
                                <div className={`mt-4 flex items-center gap-1 text-xs font-semibold transition-all duration-200
                                    ${isHovered ? "text-slate-800 translate-x-0.5" : "text-slate-300"}`}>
                                    Chọn
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ─── Chat Panel (single model panel) ─────────────────────────────────────────

interface ChatPanelProps {
    instanceId: number;
    showSidebar?: boolean;
    onSidebarToggle?: (isOpen: boolean) => void;
    externalInput?: { text: string; ts: number } | null;
    onExternalSend?: (text: string) => void;
    isCompareMode?: boolean;
    onModelLoadedChange?: (loaded: boolean) => void;
    externalParams?: InferenceParams;
    onLog?: (log: Omit<LogEntry, "ts">) => void;
}

function ChatPanel({
    instanceId,
    showSidebar = false,
    onSidebarToggle,
    externalInput,
    isCompareMode = false,
    onModelLoadedChange,
    externalParams,
    onLog,
}: ChatPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const [hfHubId, setHfHubId] = useState("");
    const [provider, setProvider] = useState<string>("local");
    const [registries, setRegistries] = useState<any[]>([]);
    const [selectedRegistryId, setSelectedRegistryId] = useState<string>("");
    const [activeModelId, setActiveModelId] = useState<string>("");
    const [modelLoaded, setModelLoaded] = useState(false);
    const [isSidebarOpen, setSidebarOpen] = useState(true);
    const [chatSessions, setChatSessions] = useState<any[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Params: nếu có externalParams (compare mode) thì dùng, không thì dùng local
    //setLocalParams chỉ để giữ state của params trong single mode, tránh bị reset khi chuyển qua lại giữa compare và single
    const [localParams] = useState<InferenceParams>(DEFAULT_PARAMS);
    const params: InferenceParams = externalParams ?? localParams;

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Notify parent when modelLoaded changes
    useEffect(() => {
        onModelLoadedChange?.(modelLoaded);
    }, [modelLoaded]);

    const fetchChatSessions = async () => {
        try {
            const sessions = await apiService.getChatSessions(30);
            setChatSessions(sessions);
        } catch (error) {
            console.error("Failed to fetch chat sessions:", error);
        }
    };

    const fetchRegistries = async () => {
        try {
            const data = await apiService.listModelRegistries();
            setRegistries(data);
        } catch (error) {
            console.error("Failed to fetch registries:", error);
        }
    };

    useEffect(() => {
        if (showSidebar) fetchChatSessions();
        fetchRegistries();
    }, [showSidebar]);

    const handleRegistryChange = async (registryId: string) => {
        setSelectedRegistryId(registryId);
        if (!registryId) return;

        setLoading(true);
        try {
            const response = await fetch(`/api/model-registry/${registryId}/active`);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.message || 'Không tìm thấy bản Active');
            }
            const activeVersion = await response.json();
            setHfHubId(activeVersion.hfRepoId);
            setLoadError(null);
            onLog?.({
                message: `Đã tự động chọn bản Active (Use): ${activeVersion.version} (${activeVersion.hfRepoId})`,
                type: "success",
                instanceId
            });
        } catch (error: any) {
            setLoadError(error.message);
            onLog?.({ message: error.message, type: "error", instanceId });
        } finally {
            setLoading(false);
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, loading]);

    const handleLoadSession = async (sessionMeta: any) => {
        try {
            const fullSession = await apiService.getChatSessionById(sessionMeta._id);
            if (fullSession?.messages) {
                setMessages(fullSession.messages.map((m: any) => ({
                    role: m.role, content: m.content, model: m.model, responseTime: m.responseTime,
                })));
                setCurrentSessionId(fullSession._id);
                const lastAi = fullSession.messages.slice().reverse().find((m: any) => m.role === "ai" && m.model);
                if (lastAi?.model && !hfHubId) setHfHubId(lastAi.model);
            }
        } catch (error) { console.error("Failed to load session:", error); }
    };

    const handleNewChat = () => { setMessages([]); setCurrentSessionId(null); };

    // const handleStopResponse = () => {
    //     abortControllerRef.current?.abort();
    //     abortControllerRef.current = null;
    //     setLoading(false);
    // };

    // sendMessage can be called externally (compare mode) or internally
    const sendMessage = useCallback(async (textOverride?: string) => {
        const text = textOverride ?? "";
        const isLocal = provider === "local" || provider === "registry";
        if (!text.trim() || loading) return;
        if (isLocal && (!hfHubId.trim() || !modelLoaded)) return;

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const userMessage: Message = { role: "user", content: text };
        setMessages((prev) => [...prev, userMessage]);
        setLoading(true);
        onLog?.({
            message: `Bắt đầu inference...`,
            type: "info",
            instanceId,
            data: params.systemPrompt ? { systemPrompt: params.systemPrompt } : undefined
        });

        const startTime = Date.now();
        let aiContent = "";

        setMessages((prev) => [...prev, { role: "ai", content: "", model: isLocal ? hfHubId : provider }]);

        try {
            const options = {
                instanceId,
                modelRegistryId: provider === "registry" ? selectedRegistryId : undefined,
                system_prompt: params.systemPrompt || undefined,
                max_new_tokens: params.maxNewTokens === "" ? undefined : params.maxNewTokens,
                temperature: params.temperature === "" ? undefined : params.temperature,
                top_k: params.topK === "" ? undefined : params.topK,
                top_p: params.topP === "" ? undefined : params.topP,
                repetition_penalty: params.repetitionPenalty === "" ? undefined : params.repetitionPenalty,
                provider: (provider === "local" || provider === "registry") ? undefined : provider,
                signal: abortController.signal,
                onFinalInfo: (info: any) => {
                    if (info.input_parameters) {
                        setMessages((prev) => {
                            const arr = [...prev];
                            arr[arr.length - 1] = { ...arr[arr.length - 1], parameters: info.input_parameters };
                            return arr;
                        });
                        onLog?.({ message: `Nhận thông số inference (Final Info)`, type: "info", instanceId, data: info.input_parameters });
                    }
                }
            };

            await apiService.inferStream(text, hfHubId, options, (chunk: string) => {
                aiContent += chunk;
                setMessages((prev) => {
                    const arr = [...prev];
                    arr[arr.length - 1] = { ...arr[arr.length - 1], content: aiContent };
                    return arr;
                });
            });

            const responseTime = (Date.now() - startTime) / 1000;
            setMessages((prev) => {
                const arr = [...prev];
                arr[arr.length - 1] = { ...arr[arr.length - 1], responseTime };
                return arr;
            });
            onLog?.({ message: `Hoàn thành inference trong ${responseTime.toFixed(2)}s`, type: "success", instanceId });

            try {
                const gpuLogsContent = await apiService.getInferenceLogs(instanceId);
                if (Array.isArray(gpuLogsContent)) {
                    const latestLog = gpuLogsContent.filter((l: any) => l.slot_id === instanceId).pop();
                    if (latestLog && latestLog.input_parameters) {
                        onLog?.({ message: `Tham số inference thực tế (GPU)`, type: "info", instanceId, data: latestLog.input_parameters });
                    }
                } else if (gpuLogsContent && gpuLogsContent.input_parameters) {
                    onLog?.({ message: `Tham số inference thực tế (GPU)`, type: "info", instanceId, data: gpuLogsContent.input_parameters });
                }
            } catch (err) {
                console.warn("Failed to fetch exact GPU logs:", err);
            }

            try {
                const payload = { userMessage: text, aiMessage: aiContent, model: hfHubId, responseTime };
                if (currentSessionId) {
                    await apiService.appendMessageToSession(currentSessionId, payload);
                } else {
                    const newSession = await apiService.createChatSession(payload);
                    setCurrentSessionId(newSession._id);
                    fetchChatSessions();
                }
            } catch (err) { console.error("Failed to save session", err); }

        } catch (error: any) {
            if (!error.name?.includes("Abort") && !error.message?.includes("aborted")) {
                const errorMsg = error.response?.data?.error || error.message;
                setLoadError(errorMsg); // Hiển thị lỗi lên badge trạng thái
                toast.error(`Lỗi model: ${errorMsg}`); // Hiển thị toast thông báo

                setMessages((prev) => {
                    const arr = [...prev];
                    arr[arr.length - 1] = { ...arr[arr.length - 1], content: `[Lỗi: ${errorMsg}]` };
                    return arr;
                });
                onLog?.({ message: `Lỗi inference: ${error.message}`, type: "error", instanceId });
            } else {
                onLog?.({ message: `Inference bị huỷ`, type: "warning", instanceId });
            }
        } finally {
            setLoading(false);
            abortControllerRef.current = null;
        }
    }, [loading, hfHubId, modelLoaded, instanceId, params, currentSessionId, provider]);

    // Expose sendMessage for compare mode via ref
    const sendMessageRef = useRef(sendMessage);
    useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

    // Listen for external send trigger in compare mode
    useEffect(() => {
        if (externalInput && externalInput.text.trim() !== "") {
            sendMessageRef.current(externalInput.text);
        }
    }, [externalInput?.ts]);

    const handleConfirmModel = async () => {
        const isLocalOrRegistry = provider === "local" || provider === "registry";
        if (!isLocalOrRegistry) {
            setLoading(true);
            setLoadError(null);
            try {
                // Validate external model before setting it active
                await apiService.validateModel(hfHubId, provider);
                setActiveModelId(hfHubId || "(Default Model)");
                setModelLoaded(true);
                toast.success(`Đã kết nối model: ${hfHubId || "Mặc định"}`);
            } catch (error: any) {
                const errorMsg = error.response?.data?.error || error.message;
                setLoadError(errorMsg);
                setModelLoaded(false);
                toast.error(`Model không hợp lệ: ${errorMsg}`);
            } finally {
                setLoading(false);
            }
            return;
        }
        if (!hfHubId.trim()) {
            setLoadError(provider === "registry" ? "Vui lòng chọn Model Registry" : "Vui lòng nhập Hugging Face Hub ID");
            return;
        }
        setLoading(true);
        setModelLoaded(false);
        setLoadError(null);
        onLog?.({ message: `Bắt đầu load model: ${hfHubId}`, type: "info", instanceId });
        try {
            const options: any = {
                instanceId,
                system_prompt: params.systemPrompt || undefined,
                max_new_tokens: params.maxNewTokens === "" ? undefined : params.maxNewTokens,
                temperature: params.temperature === "" ? undefined : params.temperature,
                top_k: params.topK === "" ? undefined : params.topK,
                top_p: params.topP === "" ? undefined : params.topP,
                repetition_penalty: params.repetitionPenalty === "" ? undefined : params.repetitionPenalty,
                provider: "local" //Registry cũng sử dụng GPU service cục bộ
            };
            await apiService.loadModel(hfHubId, options);
            setActiveModelId(hfHubId);
            setModelLoaded(true);
            toast.success("Model đã được tải thành công!");
            onLog?.({ message: `Load model thành công: ${hfHubId}`, type: "success", instanceId });
        } catch (error: any) {
            const errorMsg = error.response?.data?.error || error.message;
            setLoadError(errorMsg);
            setModelLoaded(false);
            onLog?.({ message: `Lỗi load model: ${errorMsg}`, type: "error", instanceId });
        } finally {
            setLoading(false);
        }
    };

    // const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    //     if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); }
    // };

    // ── Model status badge ──
    const ModelStatus = () => {
        if (loading && !modelLoaded) return (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                <Loader2 size={12} className="animate-spin" />
                <span>Đang tải model...</span>
            </div>
        );
        if (loadError) return (
            <div className="flex items-center gap-2 text-[12px] text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded-xl shadow-sm animate-in fade-in slide-in-from-top-1">
                <AlertCircle size={14} className="shrink-0" />
                <span className="font-medium">Lỗi: {loadError}</span>
            </div>
        );
        if (modelLoaded) return (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full shadow-sm">
                <CheckCircle2 size={12} />
                <span className="font-medium truncate max-w-[150px]">Active: {activeModelId}</span>
            </div>
        );
        return null;
    };

    return (
        <div className="flex h-full bg-white overflow-hidden">
            {/* Sidebar */}
            {showSidebar && (
                <div className={`flex flex-col bg-slate-50 border-r border-slate-200 transition-[width] duration-300 ${isSidebarOpen ? "w-64" : "w-14"} shrink-0 hidden md:flex`}>
                    <div className="flex items-center justify-between p-3 mb-4 border-b border-slate-200">
                        <button
                            onClick={() => { const s = !isSidebarOpen; setSidebarOpen(s); onSidebarToggle?.(s); }}
                            className="p-2 hover:bg-slate-200 rounded-xl transition-colors"
                        >
                            <Menu size={18} className="text-slate-600" />
                        </button>
                        {isSidebarOpen && (
                            <button
                                onClick={handleNewChat}
                                className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                            >
                                <Plus size={14} /> Tạo mới
                            </button>
                        )}
                    </div>
                    {isSidebarOpen && (
                        <div className="flex-1 overflow-y-auto px-2">
                            <p className="text-[11px] text-slate-400 uppercase tracking-widest font-semibold px-2 mb-2">Lịch sử</p>
                            <div className="flex flex-col gap-0.5">
                                {chatSessions.length === 0 ? (
                                    <div className="text-xs text-slate-400 px-3 py-2 italic">Chưa có lịch sử</div>
                                ) : chatSessions.map((session, i) => (
                                    <button
                                        key={session._id || i}
                                        onClick={() => handleLoadSession(session)}
                                        className={`flex items-center gap-2 p-2.5 rounded-xl transition-colors text-xs w-full text-left truncate
                                            ${currentSessionId === session._id ? "bg-slate-800 text-white" : "hover:bg-slate-200 text-slate-600"}`}
                                    >
                                        <MessageSquare size={13} className="shrink-0 ml-0.5" />
                                        <span className="truncate">{session.title}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Main panel */}
            <div className="flex-1 flex flex-col relative min-w-0">
                {/* Panel header */}
                <div className="border-b border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-center gap-2">
                            <select
                                value={provider}
                                onChange={(e) => {
                                    const newProvider = e.target.value;
                                    setProvider(newProvider);
                                    setModelLoaded(newProvider !== "local" && newProvider !== "registry");
                                    setLoadError(null);
                                    if (newProvider === "registry" && registries.length > 0) {
                                        handleRegistryChange(registries[0]._id);
                                    }
                                }}
                                className="bg-slate-50 border border-slate-200 text-[13px] text-slate-800 outline-none px-3 py-2 rounded-xl focus:border-slate-400 transition-all"
                            >
                                <option value="local">Manual ID</option>
                                <option value="registry">Model Registry</option>
                                <option value="openrouter">OpenRouter</option>
                            </select>

                            {provider === "registry" ? (
                                <div className="flex-1 relative">
                                    <select
                                        value={selectedRegistryId}
                                        onChange={(e) => handleRegistryChange(e.target.value)}
                                        className={`w-full bg-slate-50 border text-[13px] text-slate-800 outline-none px-4 py-2 rounded-xl transition-all
                                            focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:opacity-60
                                            ${loadError ? "border-red-200" : "border-slate-200"}`}
                                        disabled={loading}
                                    >
                                        <option value="">Chọn Model Registry...</option>
                                        {registries.map(r => (
                                            <option key={r._id} value={r._id}>{r.name}</option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <div className="flex-1 relative">
                                    <input
                                        type="text"
                                        className={`w-full bg-slate-50 border text-[13px] text-slate-800 outline-none px-4 py-2 rounded-xl transition-all
                                            focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-100 placeholder-slate-400 disabled:opacity-60
                                            ${loadError ? "border-red-200" : "border-slate-200"}`}
                                        placeholder={
                                            provider === "local"
                                                ? (isCompareMode ? `Model ${instanceId}: VD: org/model-name` : "Nhập Hugging Face Hub ID")
                                                : "Model ID (tùy chọn, VD: openai/gpt-4o)"
                                        }
                                        value={hfHubId}
                                        onChange={(e) => { setHfHubId(e.target.value); if (provider === "local") setModelLoaded(false); setLoadError(null); }}
                                        disabled={loading}
                                    />
                                </div>
                            )}

                            <button
                                onClick={handleConfirmModel}
                                disabled={(provider === "local" && !hfHubId.trim()) || (provider === "registry" && !hfHubId.trim()) || loading || ((provider === "local" || provider === "registry") && modelLoaded)}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap active:scale-95 border
                                    ${modelLoaded && (provider === "local" || provider === "registry")
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default"
                                        : loading
                                            ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                                            : "bg-slate-800 hover:bg-slate-700 text-white border-slate-800 disabled:opacity-40"
                                    }`}
                            >
                                {loading && !modelLoaded ? "Tải..." : modelLoaded && (provider === "local" || provider === "registry") ? "✓ Sẵn sàng" : provider !== "local" && provider !== "registry" ? "Sử dụng API" : "Load"}
                            </button>
                        <ModelStatus />
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4 scroll-smooth" id={`chat-${instanceId}`}>
                    {messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center px-4">
                            <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
                                <Sparkles size={22} className="text-white" />
                            </div>
                            <p className="text-slate-400 text-sm font-medium">
                                {modelLoaded
                                    ? "Model đã sẵn sàng. Hãy bắt đầu chat!"
                                    : "Load model để bắt đầu hội thoại"}
                            </p>
                            {isCompareMode && !modelLoaded && (
                                <p className="text-xs text-slate-300 mt-1">Nhập Model {instanceId} ID ở trên</p>
                            )}
                        </div>
                    ) : (
                        <div className={`${isCompareMode ? "max-w-full" : "max-w-[720px] mx-auto"} flex flex-col gap-6`}>
                            {messages.map((msg, index) => (
                                <div key={index} className="group flex flex-col">
                                    {msg.role === "user" ? (
                                        <div className="self-end text-slate-800 bg-slate-100 border border-slate-200 px-4 py-2.5 rounded-2xl rounded-br-sm max-w-[85%] text-[14px] leading-relaxed whitespace-pre-wrap break-words">
                                            {msg.content}
                                        </div>
                                    ) : (
                                        <div className="flex items-start gap-3 w-full">
                                            <div className="mt-0.5 shrink-0 w-6 h-6 bg-slate-800 rounded-lg flex items-center justify-center">
                                                <Sparkles size={12} className="text-white" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[14px] leading-relaxed text-slate-700">
                                                    <MarkdownRenderer content={msg.content} />
                                                </div>
                                                {msg.responseTime && (
                                                    <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-300 hover:text-slate-600 transition-colors" title="Thử lại">
                                                            <RotateCcw size={13} />
                                                        </button>
                                                        <button className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-300 hover:text-slate-600 transition-colors">
                                                            <MoreVertical size={13} />
                                                        </button>
                                                        <span className="text-[11px] text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                                                            {msg.responseTime.toFixed(2)}s
                                                            {msg.model && !isCompareMode && ` • ${msg.model}`}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {loading && (
                                <div className="flex items-center gap-3">
                                    <div className="w-6 h-6 bg-slate-100 rounded-lg flex items-center justify-center">
                                        <Loader2 size={12} className="animate-spin text-slate-500" />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {[0, 0.15, 0.3].map((delay, i) => (
                                            <span key={i} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${delay}s` }} />
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                #chat-${instanceId}::-webkit-scrollbar { width: 4px; }
                #chat-${instanceId}::-webkit-scrollbar-track { background: transparent; }
                #chat-${instanceId}::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; }
                #chat-${instanceId}:hover::-webkit-scrollbar-thumb { background: #cbd5e1; }
            `}</style>
        </div>
    );
}

// ─── Single Mode Page ─────────────────────────────────────────────────────────

function SingleChatPage({ onBack }: { onBack: () => void }) {
    const [input, setInput] = useState("");
    const [sendTrigger, setSendTrigger] = useState<{ text: string; ts: number } | null>(null);
    const [panelModelLoaded, setPanelModelLoaded] = useState(false);
    const [params, setParams] = useState<InferenceParams>(DEFAULT_PARAMS);
    const [showSettings, setShowSettings] = useState(false);
    const settingsRef = useRef<HTMLDivElement>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [showLogs, setShowLogs] = useState(false);

    const handleLog = useCallback((log: Omit<LogEntry, "ts">) => {
        setLogs(prev => [...prev, { ...log, ts: Date.now() }]);
    }, []);

    const handleSend = () => {
        if (!input.trim() || !panelModelLoaded) return;
        setSendTrigger({ text: input, ts: Date.now() });
        setInput("");
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
                setShowSettings(false);
            }
        };
        if (showSettings) document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [showSettings]);

    return (
        <div className="flex flex-col h-screen bg-slate-50">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 shrink-0">
                <div className="px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 hover:text-slate-800">
                            <ArrowLeft size={16} />
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-slate-800 rounded-lg flex items-center justify-center">
                                <MonitorSmartphone size={13} className="text-white" />
                            </div>
                            <span className="text-sm font-bold text-slate-800">Single Model</span>
                        </div>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">AI Chatbot</span>
                </div>
            </header>

            {/* Panel */}
            <div className="flex-1 overflow-hidden">
                <ChatPanel
                    instanceId={1}
                    showSidebar={true}
                    externalInput={sendTrigger}
                    isCompareMode={false}
                    onModelLoadedChange={setPanelModelLoaded}
                    externalParams={params}
                    onLog={handleLog}
                />
            </div>

            {/* Unified input bar */}
            <div className="bg-white border-t border-slate-200 px-4 py-3 shrink-0 relative">
                {showLogs && <GlobalLogsPanel logs={logs} onClose={() => setShowLogs(false)} />}
                <div className="max-w-[800px] mx-auto">
                    {!panelModelLoaded && (
                        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-2">
                            <AlertCircle size={13} />
                            Vui lòng load model trước khi chat.
                        </div>
                    )}

                    {/* Params summary */}
                    <ParamsSummaryBar
                        params={params}
                        onToggleLogs={() => setShowLogs(!showLogs)}
                        showLogsActive={showLogs}
                    />

                    <div className={`relative flex items-end gap-2 bg-slate-50 border rounded-2xl px-3 py-2 transition-all
                        ${panelModelLoaded ? "border-slate-300 focus-within:border-slate-500 focus-within:bg-white" : "border-slate-200 opacity-60"}`}>

                        {/* Settings button */}
                        <div className="relative shrink-0" ref={settingsRef}>
                            <button
                                onClick={() => setShowSettings(!showSettings)}
                                className={`p-2 rounded-xl transition-all border ${showSettings
                                    ? "bg-slate-800 text-white border-slate-800"
                                    : "bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600"}`}
                                title="Tham số Inference"
                            >
                                <Settings2 size={15} />
                            </button>
                            {showSettings && (
                                <ParamsDropdown
                                    params={params}
                                    onChange={setParams}
                                    onClose={() => setShowSettings(false)}
                                />
                            )}
                        </div>

                        <textarea
                            value={input}
                            onChange={(e) => {
                                setInput(e.target.value);
                                e.target.style.height = "auto";
                                e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder={panelModelLoaded ? "Nhập câu lệnh..." : "Load model để bắt đầu..."}
                            className="flex-1 bg-transparent outline-none resize-none text-[14px] text-slate-800 placeholder-slate-400 py-1.5 px-1"
                            rows={1}
                            style={{ minHeight: "36px" }}
                            disabled={!panelModelLoaded}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || !panelModelLoaded}
                            className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0 active:scale-95"
                        >
                            <Send size={15} />
                        </button>
                    </div>
                    <p className="text-[11px] text-slate-300 text-center mt-1.5">Enter để gửi • Shift+Enter xuống dòng</p>
                </div>
            </div>
        </div>
    );
}

// ─── Compare Mode Page ────────────────────────────────────────────────────────

function CompareChatPage({ onBack }: { onBack: () => void }) {
    const [input, setInput] = useState("");
    const [model1Loaded, setModel1Loaded] = useState(false);
    const [model2Loaded, setModel2Loaded] = useState(false);
    const [sendTrigger, setSendTrigger] = useState<{ text: string; ts: number } | null>(null);
    const [params, setParams] = useState<InferenceParams>(DEFAULT_PARAMS);
    const [showSettings, setShowSettings] = useState(false);
    const settingsRef = useRef<HTMLDivElement>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [showLogs, setShowLogs] = useState(false);

    const handleLog = useCallback((log: Omit<LogEntry, "ts">) => {
        setLogs(prev => [...prev, { ...log, ts: Date.now() }]);
    }, []);

    const bothLoaded = model1Loaded && model2Loaded;

    const handleSend = () => {
        if (!input.trim() || !bothLoaded) return;
        const text = input;
        setSendTrigger({ text, ts: Date.now() });
        setInput("");
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
                setShowSettings(false);
            }
        };
        if (showSettings) document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [showSettings]);

    return (
        <div className="flex flex-col h-screen bg-slate-100">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 shrink-0">
                <div className="px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 hover:text-slate-800">
                            <ArrowLeft size={16} />
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-slate-800 rounded-lg flex items-center justify-center">
                                <SplitSquareHorizontal size={13} className="text-white" />
                            </div>
                            <span className="text-sm font-bold text-slate-800">Compare 2 Models</span>
                        </div>
                    </div>
                    {/* Load status */}
                    <div className="flex items-center gap-2">
                        <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full border
                            ${model1Loaded ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-slate-50 text-slate-400 border-slate-200"}`}>
                            {model1Loaded ? <CheckCircle2 size={11} /> : <Loader2 size={11} className="opacity-40" />}
                            Model 1
                        </div>
                        <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full border
                            ${model2Loaded ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-slate-50 text-slate-400 border-slate-200"}`}>
                            {model2Loaded ? <CheckCircle2 size={11} /> : <Loader2 size={11} className="opacity-40" />}
                            Model 2
                        </div>
                        {bothLoaded && (
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full bg-slate-800 text-white">
                                <Sparkles size={11} />
                                Sẵn sàng so sánh
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Two panels */}
            <div className="flex-1 flex gap-px overflow-hidden">
                <div className="flex-1 overflow-hidden bg-white border-r border-slate-200">
                    <ChatPanel
                        instanceId={1}
                        showSidebar={false}
                        isCompareMode={true}
                        externalInput={sendTrigger}
                        onModelLoadedChange={setModel1Loaded}
                        externalParams={params}
                        onLog={handleLog}
                    />
                </div>
                <div className="flex-1 overflow-hidden bg-white">
                    <ChatPanel
                        instanceId={2}
                        showSidebar={false}
                        isCompareMode={true}
                        externalInput={sendTrigger}
                        onModelLoadedChange={setModel2Loaded}
                        externalParams={params}
                        onLog={handleLog}
                    />
                </div>
            </div>

            {/* Unified input bar */}
            <div className="bg-white border-t border-slate-200 px-6 py-3 shrink-0 relative">
                {showLogs && <GlobalLogsPanel logs={logs} onClose={() => setShowLogs(false)} />}

                {!bothLoaded && (
                    <div className="flex items-center gap-2 text-xs mb-2 text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <AlertCircle size={13} />
                        {!model1Loaded && !model2Loaded
                            ? "Vui lòng load cả 2 model trước khi chat."
                            : !model1Loaded ? "Đang chờ Model 1 load xong..."
                                : "Đang chờ Model 2 load xong..."}
                    </div>
                )}

                {/* Params summary — shared cho cả 2 */}
                <ParamsSummaryBar
                    params={params}
                    onToggleLogs={() => setShowLogs(!showLogs)}
                    showLogsActive={showLogs}
                />

                <div className={`flex items-end gap-3 bg-slate-50 border rounded-2xl px-4 py-2.5 transition-all
                    ${bothLoaded ? "border-slate-300 focus-within:border-slate-600 focus-within:bg-white shadow-sm" : "border-slate-200 opacity-50"}`}>

                    {/* Settings button */}
                    <div className="relative shrink-0" ref={settingsRef}>
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className={`p-2 rounded-xl transition-all border ${showSettings
                                ? "bg-slate-800 text-white border-slate-800"
                                : "bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600"}`}
                            title="Tham số Inference (áp dụng cho cả 2 model)"
                        >
                            <Settings2 size={15} />
                        </button>
                        {showSettings && (
                            <ParamsDropdown
                                params={params}
                                onChange={setParams}
                                onClose={() => setShowSettings(false)}
                            />
                        )}
                    </div>

                    <textarea
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            e.target.style.height = "auto";
                            e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={bothLoaded ? "Nhập câu hỏi — sẽ gửi đến cả 2 model cùng lúc..." : "Load đủ 2 model để bắt đầu..."}
                        className="flex-1 bg-transparent outline-none resize-none text-[14px] text-slate-800 placeholder-slate-400 py-1"
                        rows={1}
                        style={{ minHeight: "36px" }}
                        disabled={!bothLoaded}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || !bothLoaded}
                        className="p-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0 active:scale-95 flex items-center gap-2"
                    >
                        <Send size={15} />
                        <span className="text-xs font-semibold hidden sm:block">Gửi đến cả 2</span>
                    </button>
                </div>
                <p className="text-[11px] text-slate-300 text-center mt-1.5">Enter để gửi • Shift+Enter xuống dòng • Tham số áp dụng cho cả 2 model</p>
            </div>
        </div>
    );
}

// ─── Main ChatPage ─────────────────────────────────────────────────────────────

export default function ChatPage() {
    const [mode, setMode] = useState<ChatMode>("select");

    if (mode === "select") {
        return <ModeSelectScreen onSelect={(m) => setMode(m)} />;
    }
    if (mode === "single") {
        return <SingleChatPage onBack={() => setMode("select")} />;
    }
    return <CompareChatPage onBack={() => setMode("select")} />;
}

// Named export for backward compat
export { ChatPage };