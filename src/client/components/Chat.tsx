import { useState, useRef, useEffect, memo } from "react";
import { Markdown } from "./Markdown";
import { ToolDisplay } from "./ToolDisplay";
import { CommandDisplay, hasCommandTags } from "./CommandDisplay";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Send,
  Bot,
  User,
  Loader2,
  ChevronDown,
  ChevronUp,
  Brain,
  MessageSquare,
  Plus,
  History,
  Terminal,
  Square,
  Menu,
  RefreshCw,
} from "lucide-react";

const MESSAGES_PER_PAGE = 20;

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(MESSAGES_PER_PAGE);
  const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pollingRef = useRef<number | null>(null);
  const messageCountRef = useRef<number>(0);

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

  // Poll for streaming updates while loading
  useEffect(() => {
    if (!isLoading) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    console.log("[Polling] Starting polling, isLoading:", isLoading);

    const pollSession = async () => {
      try {
        const sessionId = streamingSessionId || currentSessionId;
        console.log("[Polling] Poll tick, sessionId:", sessionId);

        // If no session ID, we're creating a new session - don't poll yet
        if (!sessionId) {
          console.log("[Polling] No session ID yet (new session being created)");
          return;
        }

        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = await res.json();
        console.log("[Polling] Got messages:", data.messages?.length, "baseline:", messageCountRef.current);
        // Only update if we have MORE messages than our baseline (user message + response)
        if (data.success && data.messages.length > messageCountRef.current) {
          setMessages(data.messages);
          messageCountRef.current = data.messages.length;
        }
      } catch (err) {
        console.log("[Polling] Error:", err);
      }
    };

    // Poll every 500ms
    pollingRef.current = window.setInterval(pollSession, 500);
    // Also poll immediately
    pollSession();

    return () => {
      console.log("[Polling] Cleanup");
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isLoading, streamingSessionId, currentSessionId]);

  const refreshMessages = async () => {
    if (!currentSessionId || isRefreshing) return;

    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/sessions/${currentSessionId}`);
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages);
        setTimeout(scrollToBottom, 200);
      }
    } catch (error) {
      console.error("Failed to refresh:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const startNewSession = () => {
    setMessages([]);
    setCurrentSessionId(null);
    setVisibleCount(MESSAGES_PER_PAGE);
    setSheetOpen(false);
    messageCountRef.current = 0;
  };

  const selectSession = async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setIsLoading(true);
    setSheetOpen(false);
    setVisibleCount(MESSAGES_PER_PAGE);

    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json();

      if (data.success) {
        setMessages(data.messages);
        messageCountRef.current = data.messages.length;
        setTimeout(scrollToBottom, 200);
      } else {
        setMessages([]);
        messageCountRef.current = 0;
      }
    } catch (error) {
      console.error("Failed to load session:", error);
      setMessages([]);
      messageCountRef.current = 0;
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = () => {
    const trimmed = inputRef.current?.value?.trim() || "";
    if (!trimmed || isLoading) return;

    // Clear input immediately
    if (inputRef.current) inputRef.current.value = "";
    setInput("");

    const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    setCurrentRequestId(requestId);

    // Reset streaming session for new sessions
    if (!currentSessionId) {
      setStreamingSessionId(null);
    }

    // Add user message immediately
    setMessages((prev) => {
      const newMessages = [...prev, { role: "user", content: trimmed }];
      // Track message count so polling doesn't overwrite with stale data
      messageCountRef.current = newMessages.length;
      return newMessages;
    });
    setIsLoading(true);

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: trimmed,
        ...(currentSessionId && { sessionId: currentSessionId }),
        requestId,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        // Polling already updates messages, just handle errors
        if (data.aborted) {
          setMessages((prev) => [
            ...prev,
            { role: "system", content: "Request aborted" },
          ]);
        } else if (!data.success) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${data.error || "Unknown error"}` },
          ]);
        }
        // Refresh sessions list and set new session if we created one
        fetchSessions().then(async () => {
          if (!currentSessionId && data.success) {
            // New session was created - fetch sessions to get the new ID
            const sessionsRes = await fetch("/api/sessions");
            const sessionsData = await sessionsRes.json();
            if (sessionsData.success && sessionsData.sessions.length > 0) {
              const newSessionId = sessionsData.sessions[0].id;
              setCurrentSessionId(newSessionId);
              // Load the new session messages
              const sessionRes = await fetch(`/api/sessions/${newSessionId}`);
              const sessionData = await sessionRes.json();
              if (sessionData.success) {
                setMessages(sessionData.messages);
                messageCountRef.current = sessionData.messages.length;
              }
            }
          }
        });
      })
      .catch(() => {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Failed to connect to server" },
        ]);
      })
      .finally(() => {
        setIsLoading(false);
        setCurrentRequestId(null);
        setStreamingSessionId(null);
      });
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
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-sm">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                Sessions
              </SheetTitle>
            </SheetHeader>
            <div className="flex flex-col">
              <Button
                variant="ghost"
                onClick={startNewSession}
                className="m-2 justify-start gap-2"
              >
                <Plus className="h-4 w-4" />
                New Session
              </Button>
              <div className="h-px bg-border" />
              <div className="flex-1 overflow-y-auto">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => selectSession(session.id)}
                    className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-muted ${
                      currentSessionId === session.id ? "bg-muted" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono text-xs">
                        {session.id.slice(0, 8)}...
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(session.modified)}
                    </span>
                  </button>
                ))}
                {sessions.length === 0 && (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    No sessions yet
                  </p>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <Bot className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold">Claude Code</h1>
            {cwd && (
              <p className="truncate text-xs text-muted-foreground">{cwd}</p>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 ${isLoading ? "text-green-500" : ""}`}
          onClick={refreshMessages}
          disabled={!currentSessionId || isRefreshing || isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing || isLoading ? "animate-spin" : ""}`} />
        </Button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Bot className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                {currentSessionId
                  ? "Continue this conversation"
                  : "Send a message to start"}
              </p>
            </div>
          )}

          {/* Load more button */}
          {messages.length > visibleCount && (
            <button
              onClick={() => setVisibleCount((prev) => prev + MESSAGES_PER_PAGE)}
              className="flex items-center justify-center gap-1.5 rounded-full bg-muted px-4 py-2 text-xs text-muted-foreground hover:bg-muted/80"
            >
              <ChevronUp className="h-3.5 w-3.5" />
              Load {Math.min(MESSAGES_PER_PAGE, messages.length - visibleCount)} older messages
            </button>
          )}

          {messages.slice(-visibleCount).map((msg, i) => (
            <MessageBubble key={messages.length - visibleCount + i} message={msg} />
          ))}

          {isLoading && (
            <div className="flex items-start gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500/10">
                <Bot className="h-4 w-4 text-orange-500" />
              </div>
              <Card className="rounded-2xl bg-muted px-3 py-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Working...</span>
                </div>
              </Card>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t p-2 pb-safe">
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Type a message..."
            disabled={isLoading}
            rows={2}
            className="min-h-[48px] flex-1 resize-none rounded-2xl"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={abortRequest}
              className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground active:opacity-80"
            >
              <Square className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => sendMessage()}
              className={`flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground active:opacity-80 ${!input.trim() ? "opacity-50" : ""}`}
            >
              <Send className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <div className="flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-400">
          <Terminal className="h-3.5 w-3.5" />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex items-start gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-primary/10" : "bg-orange-500/10"
        }`}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary" />
        ) : (
          <Bot className="h-4 w-4 text-orange-500" />
        )}
      </div>

      <div className={`flex min-w-0 max-w-[85%] flex-col gap-2 ${isUser ? "items-end" : ""}`}>
        {/* Thinking */}
        {message.thinking && message.thinking.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1.5 rounded-full bg-purple-500/10 px-3 py-1.5 text-xs text-purple-400 hover:bg-purple-500/20">
                <Brain className="h-3.5 w-3.5" />
                <span>Thinking</span>
                <ChevronDown className="h-3.5 w-3.5 [[data-state=open]_&]:rotate-180" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-1.5 rounded-xl border-purple-500/20 bg-purple-500/5 p-2.5">
                <pre className="whitespace-pre-wrap break-words text-xs text-purple-300/80">
                  {message.thinking.join("\n\n")}
                </pre>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Tools */}
        {message.toolUse && message.toolUse.length > 0 && (
          <div className="flex w-full flex-col gap-1">
            {message.toolUse.map((tool, ti) => (
              <ToolDisplay key={ti} name={tool.name} input={tool.input} />
            ))}
          </div>
        )}

        {/* Content */}
        {message.content && (
          hasCommandTags(message.content) ? (
            <CommandDisplay content={message.content} />
          ) : (
            <Card
              className={`w-full break-words rounded-2xl p-3 ${
                isUser ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {isUser ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="prose prose-sm prose-invert max-w-none [&_*]:break-words">
                  <Markdown content={message.content} />
                </div>
              )}
            </Card>
          )
        )}
      </div>
    </div>
  );
});
