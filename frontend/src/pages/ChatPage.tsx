import { useState, useRef, useEffect } from "react";
import { apiService } from "../services/api";
import {
    Menu, Plus, MessageSquare, MoreVertical,
    Sparkles,
    ThumbsUp, ThumbsDown, Copy, RotateCcw, Mic, Send
} from "lucide-react";

interface Message {
    role: "user" | "ai";
    content: string;
    responseTime?: number;
    model?: string;
}

export default function ChatPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [hfHubId, setHfHubId] = useState(""); // Lưu HF Hub ID
    const [modelLoaded, setModelLoaded] = useState(false); // Trạng thái model đã load chưa
    const [isSidebarOpen, setSidebarOpen] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, loading]);

    const sendMessage = async () => {
        if (!input.trim() || loading || !modelLoaded) return;

        const userMessage: Message = { role: "user", content: input };
        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setLoading(true);

        const startTime = Date.now();
        let aiMessageContent = "";
        
        // Tạo placeholder cho tin nhắn AI
        setMessages((prev) => [
            ...prev, 
            { role: "ai", content: "", model: hfHubId || "Hugging Face Model" }
        ]);

        try {
            await apiService.inferStream(userMessage.content, hfHubId, (chunk) => {
                aiMessageContent += chunk;
                // Cập nhật liên tục tin nhắn AI cuối cùng
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
            
            // Cập nhật lại thời gian phản hồi khi stream kết thúc
            setMessages((prev) => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = {
                    ...newMessages[newMessages.length - 1],
                    responseTime,
                };
                return newMessages;
            });

        } catch (error) {
            setMessages((prev) => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = {
                    ...newMessages[newMessages.length - 1],
                    content: aiMessageContent + "\n\n[Lỗi: " + (error as any).message + "]",
                };
                return newMessages;
            });
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmModel = async () => {
        if (!hfHubId.trim()) return;
        setLoading(true);
        setModelLoaded(false);
        
        try {
            // Initiate a dummy or actual request to load the model
            // For now, we will send a ping request to load it
            await apiService.inferStream("ping", hfHubId, () => {});
            setModelLoaded(true);
            setMessages(prev => [...prev, { role: "ai", content: `Đã load sẵn sàng model: ${hfHubId}` }]);
        } catch (error) {
            const aiMessage: Message = {
                role: "ai",
                content: "Thất bại khi load model: " + (error as any).message,
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

    return (
        <div className="flex overflow-hidden h-screen bg-white text-black font-sans selection:bg-[#4285f4] selection:text-white">

            {/* Sidebar */}
            <div className={`flex flex-col bg-[#f9fafb] border-r border-gray-200 transition-all duration-300 ${isSidebarOpen ? "w-72" : "w-16"} p-3 z-10 hidden md:flex`}>
                <div className="flex items-center gap-3 p-2 mb-6">
                    <button
                        onClick={() => setSidebarOpen(!isSidebarOpen)}
                        className="p-2 hover:bg-gray-200 rounded-full transition-colors focus:outline-none"
                    >
                        <Menu size={20} className="text-gray-700" />
                    </button>
                </div>
                {isSidebarOpen && (
                    <div className="flex-1 overflow-y-auto">
                        <div className="text-[13px] text-gray-500 px-3 mb-2 font-medium">Gần đây</div>
                        <div className="flex flex-col gap-1">
                            <button className="flex items-center gap-3 bg-blue-50 text-blue-700 hover:bg-blue-100 p-2.5 rounded-full transition-colors text-sm w-full text-left truncate">
                                <MessageSquare size={16} className="min-w-[16px] ml-1" />
                                <span className="truncate">Greeting And Offer Of Help</span>
                            </button>
                            {/* Dummy history items */}
                            {[...Array(1)].map((_, i) => (
                                <button key={i} className="flex items-center gap-3 hover:bg-gray-100 p-2.5 rounded-full transition-colors text-sm w-full text-left truncate">
                                    <MessageSquare size={16} className="min-w-[16px] text-gray-500 ml-1" />
                                    {/* <span className="truncate text-gray-400 hover:text-gray-300">Cuộc trò chuyện {i + 1}</span> */}
                                </button>
                            ))}
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
                            className="flex-1 bg-gray-50 border border-gray-200 text-[15px] text-gray-800 outline-none px-4 py-2 rounded-xl transition-all focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 placeholder-gray-400 disabled:opacity-60"
                            placeholder="Nhập Hugging Face Hub ID (VD: meta-llama/Llama-2-7b-chat-hf)"
                            value={hfHubId}
                            onChange={(e) => {
                                setHfHubId(e.target.value);
                                setModelLoaded(false); // Reset trạng thái load khi đổi ID
                            }}
                            disabled={loading}
                        />
                        <button
                            onClick={handleConfirmModel}
                            disabled={!hfHubId.trim() || loading || modelLoaded}
                            className={`px-5 py-2 rounded-xl font-medium transition-colors whitespace-nowrap ${
                                modelLoaded 
                                    ? 'bg-green-100 text-green-700 cursor-default' 
                                    : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                            }`}
                        >
                            {loading && !modelLoaded ? 'Đang tải...' : modelLoaded ? 'Đã tải' : 'Xác nhận'}
                        </button>
                    </div>

                    {/* <div className="flex items-center gap-4 mr-2">
                        <div className="hidden md:flex items-center">
                            <a href="#" className="hidden sm:inline-block bg-[#1a1a1c] hover:bg-[#282a2c] px-4 py-2 rounded-lg text-[13px] font-medium transition-colors border border-[#333537]">
                                Dùng thử Gemini Advanced
                            </a>
                        </div>
                        <div className="w-10 h-10 bg-gradient-to-br from-emerald-700 to-teal-500 rounded-full flex items-center justify-center font-bold text-white shadow-md cursor-pointer hover:opacity-90 transition-opacity">
                            <User size={20} />
                        </div>
                    </div> */}
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
                                                <div className="text-black leading-relaxed whitespace-pre-wrap text-[15.5px]">
                                                    {msg.content}
                                                </div>

                                                <div className="flex items-center gap-1 mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                    <button className="p-2.5 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-800 transition-colors" title="Câu trả lời tốt">
                                                        <ThumbsUp size={16} />
                                                    </button>
                                                    <button className="p-2.5 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-800 transition-colors" title="Câu trả lời chưa tốt">
                                                        <ThumbsDown size={16} />
                                                    </button>
                                                    <button className="p-2.5 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-800 transition-colors" title="Sao chép">
                                                        <Copy size={16} />
                                                    </button>
                                                    <button className="p-2.5 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-800 transition-colors" title="Thử lại">
                                                        <RotateCcw size={16} />
                                                    </button>
                                                    <button className="p-2.5 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-800 transition-colors" title="Thêm">
                                                        <MoreVertical size={16} />
                                                    </button>

                                                    {msg.responseTime && (
                                                        <span className="text-xs text-gray-600 ml-2 font-mono bg-gray-100 px-2 py-1 rounded">
                                                            {msg.responseTime.toFixed(2)}s • {msg.model}
                                                        </span>
                                                    )}
                                                </div>
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

                {/* Input form - Only show when model is loaded */}
                {modelLoaded && (
                    <div className="absolute bottom-0 left-0 right-0 w-full px-4 md:px-10 pb-6 pt-4 bg-white/80 backdrop-blur-md">
                        <div className="max-w-[800px] mx-auto relative group">
                            <div className="flex items-end gap-2 bg-[#f0f4f9] hover:bg-[#e9eef6] rounded-[28px] pl-4 pr-2 py-2 border border-transparent focus-within:border-gray-300 focus-within:bg-white transition-all duration-300 shadow-sm focus-within:shadow-md">
                                <button className="p-2 mb-[2px] bg-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded-full flex-shrink-0 transition-colors" title="Tải lên tệp">
                                    <Plus size={24} />
                                </button>
    
                                <textarea
                                    value={input}
                                    onChange={(e) => {
                                        setInput(e.target.value);
                                        e.target.style.height = 'auto';
                                        e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                                    }}
                                    onKeyDown={handleKeyPress}
                                    placeholder="Nhập câu lệnh tại đây..."
                                    className="w-full bg-transparent text-black border-none focus:ring-0 resize-none max-h-[200px] py-3 px-2 placeholder-gray-500 text-[15px] outline-none"
                                    rows={1}
                                    style={{ minHeight: '48px' }}
                                    disabled={!modelLoaded || loading}
                                />
    
                                <div className="flex items-center gap-1 pb-1 mb-[-2px]">
                                    {input.trim() ? (
                                        <button
                                            onClick={sendMessage}
                                            disabled={loading || !modelLoaded}
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