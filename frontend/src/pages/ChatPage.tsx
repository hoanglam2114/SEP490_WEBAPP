import { useState, useRef, useEffect } from "react";
import { apiService } from "../services/api";
import {
    Menu, Plus, MessageSquare, MoreVertical,
    Sparkles, ChevronDown, ChevronUp, Square,
    RotateCcw, Mic, Send
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";

interface Message {
    role: "user" | "ai";
    content: string;
    responseTime?: number;
    model?: string;
    parameters?: any;
    showParams?: boolean;
}

const MarkdownRenderer = ({ content }: { content: string }) => (
    <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
            strong: ({ children }) => (
                <strong className="font-semibold text-gray-900">{children}</strong>
            ),
            em: ({ children }) => (
                <em className="italic text-gray-800">{children}</em>
            ),
            code: ({ inline, children, ...props }: any) =>
                inline ? (
                    <code className="bg-gray-100 text-pink-600 px-1.5 py-0.5 rounded text-[13.5px] font-mono">
                        {children}
                    </code>
                ) : (
                    <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 overflow-x-auto my-3 text-[13.5px] font-mono leading-relaxed">
                        <code {...props}>{children}</code>
                    </pre>
                ),
            h1: ({ children }) => (
                <h1 className="text-xl font-bold text-gray-900 mt-4 mb-2">{children}</h1>
            ),
            h2: ({ children }) => (
                <h2 className="text-lg font-semibold text-gray-900 mt-3 mb-1.5">{children}</h2>
            ),
            h3: ({ children }) => (
                <h3 className="text-base font-semibold text-gray-800 mt-2 mb-1">{children}</h3>
            ),
            ul: ({ children }) => (
                <ul className="list-disc list-inside space-y-1 my-2 text-gray-800">{children}</ul>
            ),
            ol: ({ children }) => (
                <ol className="list-decimal list-inside space-y-1 my-2 text-gray-800">{children}</ol>
            ),
            li: ({ children }) => (
                <li className="leading-relaxed">{children}</li>
            ),
            blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-blue-400 pl-4 italic text-gray-600 my-3">
                    {children}
                </blockquote>
            ),
            table: ({ children }) => (
                <div className="overflow-x-auto my-3">
                    <table className="border-collapse w-full text-sm">{children}</table>
                </div>
            ),
            th: ({ children }) => (
                <th className="border border-gray-300 bg-gray-100 px-3 py-1.5 text-left font-semibold">
                    {children}
                </th>
            ),
            td: ({ children }) => (
                <td className="border border-gray-300 px-3 py-1.5">{children}</td>
            ),
            p: ({ children }) => (
                <p className="leading-relaxed mb-2 last:mb-0">{children}</p>
            ),
            hr: () => <hr className="my-4 border-gray-200" />,
        }}
    >
        {content}
    </ReactMarkdown>
);

export default function ChatPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [hfHubId, setHfHubId] = useState("");
    const [modelLoaded, setModelLoaded] = useState(false);
    const [isSidebarOpen, setSidebarOpen] = useState(true);
    const [chatSessions, setChatSessions] = useState<any[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

    const fetchChatSessions = async () => {
        try {
            const sessions = await apiService.getChatSessions(30);
            setChatSessions(sessions);
        } catch (error) {
            console.error("Failed to fetch chat sessions:", error);
        }
    };

    useEffect(() => {
        fetchChatSessions();
    }, []);

    const handleLoadSession = async (sessionMeta: any) => {
        try {
            const fullSession = await apiService.getChatSessionById(sessionMeta._id);
            if (fullSession && fullSession.messages) {
                const formattedMessages: Message[] = fullSession.messages.map((m: any) => ({
                    role: m.role,
                    content: m.content,
                    model: m.model,
                    responseTime: m.responseTime,
                }));
                setMessages(formattedMessages);
                setCurrentSessionId(fullSession._id);

                const lastAiMessage = fullSession.messages.slice().reverse().find((m: any) => m.role === 'ai' && m.model);
                if (lastAiMessage && lastAiMessage.model && !hfHubId) {
                    setHfHubId(lastAiMessage.model);
                }
            }
        } catch (error) {
            console.error("Failed to load session:", error);
        }
    };

    const handleNewChat = () => {
        setMessages([]);
        setCurrentSessionId(null);
    };

    // AI Parameters State
    const [showSettings, setShowSettings] = useState(false);
    const [systemPrompt, setSystemPrompt] = useState("");
    const [maxNewTokens, setMaxNewTokens] = useState<number | "">(512);
    const [temperature, setTemperature] = useState<number | "">(0.7);
    const [topK, setTopK] = useState<number | "">(50);
    const [topP, setTopP] = useState<number | "">(0.95);
    const [repetitionPenalty, setRepetitionPenalty] = useState<number | "">(1.1);
    const [showLastParams, setShowLastParams] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const handleStopResponse = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setLoading(false);
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, loading]);

    const sendMessage = async () => {
        if (!input.trim() || loading || !hfHubId.trim()) return;

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const userMessage: Message = { role: "user", content: input };
        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setLoading(true);

        const startTime = Date.now();
        let aiMessageContent = "";

        setMessages((prev) => [
            ...prev,
            { role: "ai", content: "", model: hfHubId || "Hugging Face Model" }
        ]);

        try {
            if (!modelLoaded) {
                try {
                    const options = {
                        system_prompt: systemPrompt || undefined,
                        max_new_tokens: maxNewTokens === "" ? undefined : maxNewTokens,
                        temperature: temperature === "" ? undefined : temperature,
                        top_k: topK === "" ? undefined : topK,
                        top_p: topP === "" ? undefined : topP,
                        repetition_penalty: repetitionPenalty === "" ? undefined : repetitionPenalty,
                    };
                    await apiService.loadModel(hfHubId, options);
                    setModelLoaded(true);
                } catch (error: any) {
                    const errorMsg = error.response?.data?.error || error.message;
                    throw new Error("Thất bại khi load model: " + errorMsg);
                }
            }

            const options = {
                system_prompt: systemPrompt || undefined,
                max_new_tokens: maxNewTokens === "" ? undefined : maxNewTokens,
                temperature: temperature === "" ? undefined : temperature,
                top_k: topK === "" ? undefined : topK,
                top_p: topP === "" ? undefined : topP,
                repetition_penalty: repetitionPenalty === "" ? undefined : repetitionPenalty,
                signal: abortController.signal,
                onFinalInfo: (info: any) => {
                    if (info.input_parameters) {
                        setMessages((prev) => {
                            const newMessages = [...prev];
                            newMessages[newMessages.length - 1] = {
                                ...newMessages[newMessages.length - 1],
                                parameters: info.input_parameters,
                            };
                            return newMessages;
                        });
                    }
                }
            };

            await apiService.inferStream(userMessage.content, hfHubId, options, (chunk: string) => {
                aiMessageContent += chunk;
                setMessages((prev) => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = {
                        ...newMessages[newMessages.length - 1],
                        content: aiMessageContent,
                    };
                    return newMessages;
                });
            });

            const responseTime = (Date.now() - startTime) / 1000;

            setMessages((prev) => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = {
                    ...newMessages[newMessages.length - 1],
                    responseTime,
                    parameters: {
                        do_sample: true,
                        max_new_tokens: maxNewTokens === "" ? undefined : maxNewTokens,
                        repetition_penalty: repetitionPenalty === "" ? undefined : repetitionPenalty,
                        system_prompt: systemPrompt || undefined,
                        temperature: temperature === "" ? undefined : temperature,
                        text_input: userMessage.content,
                        top_k: topK === "" ? undefined : topK,
                        top_p: topP === "" ? undefined : topP
                    }
                };
                return newMessages;
            });

            try {
                const payload = {
                    userMessage: userMessage.content,
                    aiMessage: aiMessageContent,
                    model: hfHubId || "Hugging Face Model",
                    responseTime,
                };

                if (currentSessionId) {
                    await apiService.appendMessageToSession(currentSessionId, payload);
                } else {
                    const newSession = await apiService.createChatSession(payload);
                    setCurrentSessionId(newSession._id);
                    fetchChatSessions();
                }
            } catch (err) {
                console.error("Failed to save chat session", err);
            }

        } catch (error: any) {
            if (error.name === "AbortError" || error.message?.includes("aborted") || error.message?.includes("The operation was aborted")) {
                console.log("Stream stopped by user");
            } else {
                setMessages((prev) => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = {
                        ...newMessages[newMessages.length - 1],
                        content: aiMessageContent + "\n\n[Lỗi: " + (error as any).message + "]",
                    };
                    return newMessages;
                });
            }
        } finally {
            setLoading(false);
            abortControllerRef.current = null;
        }
    };

    const handleConfirmModel = async () => {
        if (!hfHubId.trim()) return;
        setLoading(true);
        setModelLoaded(false);

        try {
            const options = {
                system_prompt: systemPrompt || undefined,
                max_new_tokens: maxNewTokens === "" ? undefined : maxNewTokens,
                temperature: temperature === "" ? undefined : temperature,
                top_k: topK === "" ? undefined : topK,
                top_p: topP === "" ? undefined : topP,
                repetition_penalty: repetitionPenalty === "" ? undefined : repetitionPenalty,
            };
            await apiService.loadModel(hfHubId, options);
            setModelLoaded(true);
            setMessages(prev => [...prev, { role: "ai", content: `Đã load sẵn sàng model: ${hfHubId}` }]);
        } catch (error: any) {
            const errorMsg = error.response?.data?.error || error.message;
            const aiMessage: Message = {
                role: "ai",
                content: "Thất bại khi load model: " + errorMsg,
            };
            setMessages((prev) => [...prev, aiMessage]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const lastParams = messages.slice().reverse().find(m => m.role === "ai" && m.parameters)?.parameters;

    return (
        <div className="flex overflow-hidden h-screen bg-white text-black font-sans selection:bg-[#4285f4] selection:text-white">

            {/* Sidebar */}
            <div className={`flex flex-col bg-[#f9fafb] border-r border-gray-200 transition-all duration-300 ${isSidebarOpen ? "w-72" : "w-16"} p-3 z-10 hidden md:flex`}>
                <div className="flex items-center justify-between p-2 mb-6 border-b border-gray-100 pb-4">
                    <button
                        onClick={() => setSidebarOpen(!isSidebarOpen)}
                        className="p-2 hover:bg-gray-200 rounded-full transition-colors focus:outline-none"
                    >
                        <Menu size={20} className="text-gray-700" />
                    </button>
                    {isSidebarOpen && (
                        <button
                            onClick={handleNewChat}
                            className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-full transition-colors focus:outline-none flex items-center gap-2 px-4 shadow-sm relative group"
                            title="Tạo đoạn chat mới"
                        >
                            <Plus size={18} />
                            <span className="text-sm font-semibold">Tạo mới</span>
                        </button>
                    )}
                </div>
                {isSidebarOpen && (
                    <div className="flex-1 overflow-y-auto">
                        <div className="text-[13px] text-gray-500 px-3 mb-2 font-medium">Đoạn chat của bạn</div>
                        <div className="flex flex-col gap-1">
                            {chatSessions.length === 0 ? (
                                <div className="text-sm text-gray-400 px-4 italic">Chưa có lịch sử</div>
                            ) : (
                                chatSessions.map((session, i) => (
                                    <button
                                        key={session._id || i}
                                        onClick={() => handleLoadSession(session)}
                                        className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors text-sm w-full text-left truncate ${currentSessionId === session._id ? 'bg-blue-100 text-blue-800 font-medium' : 'hover:bg-gray-100 text-gray-700'
                                            }`}
                                    >
                                        <MessageSquare size={16} className={`min-w-[16px] ml-1 ${currentSessionId === session._id ? 'text-blue-600' : 'text-gray-500'}`} />
                                        <span className="truncate" title={session.title}>{session.title}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex-1 flex flex-col relative h-full w-full bg-white">
                {/* Header */}
                <div className="flex justify-between items-center p-4 min-h-[72px]">
                    <div className="flex items-center gap-4 group w-full max-w-2xl">
                        <span className="text-[22px] text-gray-800 font-medium tracking-wide flex items-center ml-2 md:ml-0 whitespace-nowrap">
                            AI Chatbot
                        </span>
                        <input
                            type="text"
                            className="flex-1 bg-gray-50 border border-gray-100 text-[15px] text-gray-800 outline-none px-5 py-2.5 rounded-2xl transition-all focus:bg-white focus:border-blue-400 focus:ring-4 focus:ring-blue-100/50 placeholder-gray-400 disabled:opacity-60 shadow-sm"
                            placeholder="Nhập Hugging Face Hub ID (VD: meta-llama/Llama-2-7b-chat-hf)"
                            value={hfHubId}
                            onChange={(e) => {
                                setHfHubId(e.target.value);
                                setModelLoaded(false);
                            }}
                            disabled={loading}
                        />

                        <button
                            onClick={handleConfirmModel}
                            disabled={!hfHubId.trim() || loading || modelLoaded}
                            className={`px-6 py-2.5 rounded-xl font-semibold transition-all whitespace-nowrap ml-2 shadow-sm active:scale-95 ${modelLoaded
                                ? 'bg-green-100 text-green-700 cursor-default shadow-none'
                                : 'bg-[#849bf3] hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                                }`}
                        >
                            {loading && !modelLoaded ? 'Đang tải...' : modelLoaded ? 'Đã tải' : 'Xác nhận'}
                        </button>
                    </div>


                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 md:px-10 lg:px-24 xl:px-48 pb-40 pt-8 scroll-smooth" id="chat-container">
                    {messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center mt-[-50px]">
                            <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-purple-500 rounded-3xl flex items-center justify-center mb-6 shadow-lg shadow-purple-900/10">
                                <Sparkles size={32} className="text-white fill-current" />
                            </div>
                            <h2 className="text-3xl font-medium text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-600 via-gray-600 to-gray-800">
                                Xin chào bạn! Tôi có thể giúp gì cho bạn hôm nay?
                            </h2>
                        </div>
                    ) : (
                        <div className="max-w-[760px] mx-auto w-full flex flex-col gap-8">
                            {messages.map((msg, index) => (
                                <div key={index} className="flex flex-col group w-full">
                                    {msg.role === "user" ? (
                                        <div className="self-end text-black bg-[#f0f4f9] px-5 py-3 rounded-3xl max-w-[90%] md:max-w-[80%] whitespace-pre-wrap break-words leading-relaxed text-[15.5px]">
                                            {msg.content}
                                        </div>
                                    ) : (
                                        <div className="flex items-start gap-4 max-w-full w-full">
                                            <div className="mt-1 flex-shrink-0">
                                                <Sparkles className="text-blue-500 fill-current object-contain" size={26} />
                                            </div>
                                            <div className="flex-1 min-w-0 pr-0 md:pr-4">
                                                <div className="text-black leading-relaxed text-[15.5px]">
                                                    <MarkdownRenderer content={msg.content} />
                                                </div>

                                                {msg.responseTime && (
                                                    <div className="flex flex-col gap-1.5 mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                        <div className="flex items-center gap-1">
                                                            <button className="p-2.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-800 transition-colors" title="Thử lại">
                                                                <RotateCcw size={16} />
                                                            </button>
                                                            <button className="p-2.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-800 transition-colors" title="Thêm">
                                                                <MoreVertical size={16} />
                                                            </button>
                                                            <span className="text-[11px] text-gray-500 ml-2 font-medium bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100 shadow-sm">
                                                                {msg.responseTime.toFixed(2)}s • {msg.model}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                        </div>
                                    )}
                                </div>
                            ))}

                            {loading && (
                                <div className="flex items-start gap-4">
                                    <div className="mt-1">
                                        <div className="w-6 h-6 rounded-full border-2 border-blue-100 border-t-blue-500 animate-spin"></div>
                                    </div>
                                    <div className="flex-1 font-mono text-[15px] text-gray-500 flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-blue-600 font-medium tracking-wide">Đang tải model từ Hugging Face & xử lý</span>
                                            <span className="inline-flex space-x-1">
                                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></span>
                                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                                            </span>
                                        </div>
                                        <span className="text-[13px] text-gray-400 opacity-80">(Quá trình này có thể mất một chút thời gian cho lần tải đầu)</span>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>

                {modelLoaded && (
                    <div className="absolute bottom-0 left-0 right-0 w-full px-4 md:px-10 pb-6 pt-4 bg-white/80 backdrop-blur-md">
                        <div className="max-w-[800px] mx-auto relative group">
                            {showSettings && (
                                <div className="absolute bottom-full left-0 mb-4 z-50 w-[90vw] md:w-[450px] bg-white/95 backdrop-blur-xl border border-gray-100 p-7 shadow-[0_-20px_50px_rgba(0,0,0,0.15)] rounded-[32px] flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-300 origin-bottom">
                                    <div className="flex items-center justify-between mb-1">
                                        <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                                            <Sparkles size={18} className="text-blue-500" />
                                            Tham số AI
                                        </h3>
                                        <button
                                            onClick={() => setShowSettings(false)}
                                            className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
                                        >
                                            <Square size={14} />
                                        </button>
                                    </div>

                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-[13px] font-medium text-gray-500 ml-1">System Prompt</label>
                                        <div className="bg-gray-50 border border-transparent focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 rounded-2xl transition-all p-3 group">
                                            <textarea
                                                placeholder="Nhập hướng dẫn cho AI..."
                                                value={systemPrompt}
                                                onChange={(e) => setSystemPrompt(e.target.value)}
                                                className="w-full text-[15px] outline-none bg-transparent placeholder-gray-400 font-normal resize-none h-20"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-[13px] font-medium text-gray-500 ml-1">Max Tokens</label>
                                            <input
                                                type="number"
                                                placeholder="VD: 512"
                                                value={maxNewTokens}
                                                onChange={(e) => setMaxNewTokens(e.target.value === "" ? "" : Number(e.target.value))}
                                                className="w-full bg-gray-50 border border-transparent focus:bg-white focus:ring-2 focus:ring-blue-100 rounded-2xl transition-all p-3 text-[15px]"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-[13px] font-medium text-gray-500 ml-1">Temperature</label>
                                            <input
                                                type="number"
                                                step="0.1"
                                                placeholder="VD: 0.7"
                                                value={temperature}
                                                onChange={(e) => setTemperature(e.target.value === "" ? "" : Number(e.target.value))}
                                                className="w-full bg-gray-50 border border-transparent focus:bg-white focus:ring-2 focus:ring-blue-100 rounded-2xl transition-all p-3 text-[15px]"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-[13px] font-medium text-gray-500 ml-1">Top K</label>
                                            <input
                                                type="number"
                                                placeholder="VD: 50"
                                                value={topK}
                                                onChange={(e) => setTopK(e.target.value === "" ? "" : Number(e.target.value))}
                                                className="w-full bg-gray-50 border border-transparent focus:bg-white focus:ring-2 focus:ring-blue-100 rounded-2xl transition-all p-3 text-[15px]"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-[13px] font-medium text-gray-500 ml-1">Top P</label>
                                            <input
                                                type="number"
                                                step="0.05"
                                                placeholder="VD: 0.95"
                                                value={topP}
                                                onChange={(e) => setTopP(e.target.value === "" ? "" : Number(e.target.value))}
                                                className="w-full bg-gray-50 border border-transparent focus:bg-white focus:ring-2 focus:ring-blue-100 rounded-2xl transition-all p-3 text-[15px]"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-[13px] font-medium text-gray-500 ml-1">Repetition Penalty</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            placeholder="VD: 1.1"
                                            value={repetitionPenalty}
                                            onChange={(e) => setRepetitionPenalty(e.target.value === "" ? "" : Number(e.target.value))}
                                            className="w-full bg-gray-50 border border-transparent focus:bg-white focus:ring-2 focus:ring-blue-100 rounded-2xl transition-all p-3 text-[15px]"
                                        />
                                    </div>
                                </div>
                            )}

                            {showLastParams && lastParams && !showSettings && (
                                <div className="absolute bottom-full right-4 mb-4 z-50 bg-[#111111] border border-gray-800 rounded-xl p-4 shadow-xl pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200">
                                    <pre className="text-[12.5px] font-mono leading-snug m-0 text-[#e6e6e6] text-left">
                                        <span className="text-[#ce9178]">"input_parameters"</span>: {JSON.stringify(lastParams, null, 2)}
                                    </pre>
                                </div>
                            )}

                            <div className="flex items-end gap-2 bg-[#f0f4f9] hover:bg-[#e9eef6] rounded-[28px] pl-4 pr-2 py-2 border border-transparent focus-within:border-gray-300 focus-within:bg-white transition-all duration-300 shadow-sm focus-within:shadow-md">
                                <button className="p-2 mb-[2px] bg-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded-full flex-shrink-0 transition-colors" title="Tải lên tệp">
                                    <Plus size={24} />
                                </button>

                                <button
                                    onClick={() => setShowSettings(!showSettings)}
                                    className={`p-2 mb-[2px] rounded-full transition-all flex items-center justify-center shrink-0 active:scale-95 ${showSettings
                                        ? "bg-gray-800 text-white"
                                        : "text-gray-500 hover:text-gray-800 hover:bg-gray-200"
                                        }`}
                                    title="Thông số mô hình"
                                >
                                    {showSettings ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
                                </button>

                                <textarea
                                    value={input}
                                    onChange={(e) => {
                                        setInput(e.target.value);
                                        e.target.style.height = "auto";
                                        e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                                    }}
                                    onKeyDown={handleKeyPress}
                                    placeholder="Nhập câu lệnh tại đây..."
                                    className="w-full bg-transparent text-black border-none focus:ring-0 resize-none max-h-[200px] py-3 px-2 placeholder-gray-500 text-[15px] outline-none"
                                    rows={1}
                                    style={{ minHeight: "48px" }}
                                    disabled={!modelLoaded || loading}
                                />

                                <div className="flex items-center gap-1 pb-1 mb-[-2px]">
                                    {lastParams && (
                                        <button
                                            onClick={() => setShowLastParams(!showLastParams)}
                                            className={`p-2.5 rounded-full transition-all flex items-center justify-center shrink-0 active:scale-95 ${showLastParams
                                                ? "bg-gray-800 text-white shadow-md"
                                                : "bg-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-200"
                                                }`}
                                            title="Tham số AI đã dùng"
                                        >
                                            {showLastParams ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                        </button>
                                    )}
                                    {loading ? (
                                        <button
                                            onClick={handleStopResponse}
                                            className="p-3 bg-black hover:bg-gray-800 text-white rounded-full flex-shrink-0 transition-colors"
                                            title="Dừng phản hồi"
                                        >
                                            <Square size={16} fill="currentColor" strokeWidth={0} />
                                        </button>
                                    ) : input.trim() ? (
                                        <button
                                            onClick={sendMessage}
                                            disabled={!modelLoaded}
                                            className="p-3 bg-black hover:bg-gray-800 text-white rounded-full flex-shrink-0 transition-colors disabled:opacity-50"
                                        >
                                            <Send size={18} className="translate-x-[-1px]" />
                                        </button>
                                    ) : (
                                        <button className="p-3 bg-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded-full flex-shrink-0 transition-colors">
                                            <Mic size={22} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                /* Scrollbar cho Chat Container */
                #chat-container::-webkit-scrollbar {
                    width: 6px;
                }
                #chat-container::-webkit-scrollbar-track {
                    background: transparent;
                }
                #chat-container::-webkit-scrollbar-thumb {
                    background-color: transparent;
                    border-radius: 10px;
                }
                #chat-container:hover::-webkit-scrollbar-thumb {
                    background-color: #d1d5db;
                }
                
                /* Scrollbar cho Textarea */
                textarea::-webkit-scrollbar {
                    width: 6px;
                }
                textarea::-webkit-scrollbar-track {
                    background: transparent;
                }
                textarea::-webkit-scrollbar-thumb {
                    background-color: #d1d5db;
                    border-radius: 10px;
                }
            `}</style>
        </div>
    );
}