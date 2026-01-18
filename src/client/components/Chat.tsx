import { useState, useRef, useEffect } from "react";
import { Markdown } from "./Markdown";
import { ToolDisplay } from "./ToolDisplay";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import {
  Send,
  Bot,
  User,
  Loader2,
  ChevronDown,
  Brain,
  MessageSquare,
  Plus,
  History,
  Terminal,
  Square,
} from "lucide-react";

interface ToolUse {
  name: string;
  input?: {
    file_path?: string;
    old_string?: string;
    new_string?: string;
    content?: string;
    command?: string;
    description?: string;
    pattern?: string;
    path?: string;
    [key: string]: unknown;
  };
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string[];
  toolUse?: ToolUse[];
}

interface Session {
  id: string;
  modified: number;
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [cwd, setCwd] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fetchSessions = async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      if (data.success) {
        setSessions(data.sessions);
        if (data.cwd) setCwd(data.cwd);
      }
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const scrollToBottom = () => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startNewSession = () => {
    setMessages([]);
    setCurrentSessionId(null);
  };

  const selectSession = async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setIsLoading(true);

    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json();

      if (data.success) {
        setMessages(data.messages);
        // Scroll to bottom after messages load
        setTimeout(scrollToBottom, 200);
      } else {
        setMessages([]);
      }
    } catch (error) {
      console.error("Failed to load session:", error);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    const requestId = crypto.randomUUID();

    setInput("");
    setCurrentRequestId(requestId);
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          sessionId: currentSessionId,
          requestId,
        }),
      });

      const data = await res.json();

      if (data.aborted) {
        setMessages((prev) => [
          ...prev,
          { role: "system", content: "Request aborted" },
        ]);
      } else if (data.success) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response,
            thinking: data.thinking,
          },
        ]);
        // Refresh sessions list
        fetchSessions();
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${data.error}` },
        ]);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to connect to server" },
      ]);
    } finally {
      setIsLoading(false);
      setCurrentRequestId(null);
      inputRef.current?.focus();
    }
  };

  const abortRequest = async () => {
    if (!currentRequestId) return;

    try {
      await fetch("/api/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: currentRequestId }),
      });
    } catch (error) {
      console.error("Failed to abort:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: "short" });
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5" />
              <span className="font-semibold">Sessions</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={startNewSession}
              className="h-8 w-8"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <ScrollArea className="h-full">
            <SidebarMenu className="p-2">
              {sessions.map((session) => (
                <SidebarMenuItem key={session.id}>
                  <SidebarMenuButton
                    onClick={() => selectSession(session.id)}
                    isActive={currentSessionId === session.id}
                    className="w-full justify-between"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      <span className="truncate font-mono text-xs">
                        {session.id.slice(0, 8)}...
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(session.modified)}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {sessions.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No sessions yet
                </div>
              )}
            </SidebarMenu>
          </ScrollArea>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="flex h-screen min-w-0 flex-col overflow-x-hidden">
        {/* Header */}
        <header className="flex items-center gap-2 border-b px-2 py-2 sm:px-4 sm:py-3">
          <SidebarTrigger />
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary sm:h-9 sm:w-9">
              <Bot className="h-4 w-4 text-primary-foreground sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold sm:text-lg">Claude Code</h1>
              {cwd && (
                <p className="truncate font-mono text-[10px] text-muted-foreground sm:text-xs">{cwd}</p>
              )}
            </div>
          </div>
        </header>

        {/* Messages */}
        <ScrollArea className="flex-1 overflow-x-hidden" ref={scrollRef}>
          <div className="mx-auto w-full space-y-3 overflow-x-hidden p-2 sm:max-w-3xl sm:space-y-4 sm:p-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Bot className="mb-4 h-12 w-12 text-muted-foreground/50" />
                <p className="text-muted-foreground">
                  {currentSessionId
                    ? "Continue this conversation"
                    : "Send a message to start chatting with Claude Code"}
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-2 sm:gap-3 ${msg.role === "user" ? "justify-end" : ""} ${msg.role === "system" ? "justify-center" : ""}`}
              >
                {msg.role === "assistant" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/10 sm:h-8 sm:w-8">
                    <Bot className="h-3 w-3 text-orange-500 sm:h-4 sm:w-4" />
                  </div>
                )}

                {msg.role === "system" ? (
                  <div className="flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs text-cyan-400">
                    <Terminal className="h-3 w-3" />
                    <span>{msg.content}</span>
                  </div>
                ) : (
                  <div className="flex min-w-0 max-w-[80%] flex-col gap-2 overflow-hidden">
                    {/* Thinking block */}
                    {msg.thinking && msg.thinking.length > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <button className="flex items-center gap-1.5 rounded-lg bg-purple-500/10 px-2 py-1.5 text-xs text-purple-400 transition-colors hover:bg-purple-500/20 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm">
                            <Brain className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            <span>Thinking</span>
                            <ChevronDown className="h-3.5 w-3.5 transition-transform sm:h-4 sm:w-4 [[data-state=open]_&]:rotate-180" />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <Card className="mt-2 border-purple-500/20 bg-purple-500/5 px-3 py-2 sm:px-4 sm:py-3">
                            <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-purple-300/80 sm:text-xs">
                              {msg.thinking.join("\n\n")}
                            </pre>
                          </Card>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Tool usage blocks */}
                    {msg.toolUse && msg.toolUse.length > 0 && (
                      <div className="flex flex-col gap-1">
                        {msg.toolUse.map((tool, ti) => (
                          <ToolDisplay key={ti} name={tool.name} input={tool.input} />
                        ))}
                      </div>
                    )}

                    {/* Main response */}
                    {msg.content && (
                      <Card
                        className={`overflow-hidden px-3 py-2 sm:px-4 sm:py-3 ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        {msg.role === "user" ? (
                          <pre className="whitespace-pre-wrap break-all font-mono text-xs sm:text-sm">
                            {msg.content}
                          </pre>
                        ) : (
                          <div className="prose prose-sm prose-invert max-w-none overflow-x-auto text-xs sm:text-sm">
                            <Markdown content={msg.content} />
                          </div>
                        )}
                      </Card>
                    )}
                  </div>
                )}

                {msg.role === "user" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 sm:h-8 sm:w-8">
                    <User className="h-3 w-3 text-primary sm:h-4 sm:w-4" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-2 sm:gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/10 sm:h-8 sm:w-8">
                  <Bot className="h-3 w-3 text-orange-500 sm:h-4 sm:w-4" />
                </div>
                <Card className="bg-muted px-3 py-2 sm:px-4 sm:py-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" />
                    <span className="text-xs sm:text-sm">Thinking...</span>
                  </div>
                </Card>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t p-2 sm:p-4">
          <div className="mx-auto flex w-full gap-2 sm:max-w-3xl">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={isLoading}
              rows={2}
              className="min-h-[50px] resize-none text-sm sm:min-h-[60px] sm:text-base"
            />
            {isLoading ? (
              <Button
                onClick={abortRequest}
                variant="destructive"
                size="icon"
                className="h-[50px] w-[50px] shrink-0 sm:h-[60px] sm:w-[60px]"
              >
                <Square className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            ) : (
              <Button
                onClick={sendMessage}
                disabled={!input.trim()}
                size="icon"
                className="h-[50px] w-[50px] shrink-0 sm:h-[60px] sm:w-[60px]"
              >
                <Send className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
