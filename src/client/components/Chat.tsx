import { useState, useRef, useEffect, memo, useCallback } from "react";
import { Markdown } from "./Markdown";
import { ToolDisplay } from "./ToolDisplay";
import { CommandDisplay, hasCommandTags } from "./CommandDisplay";
import { SetupBanner } from "./SetupWizard";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  Shield,
  Check,
  X,
  FileText,
  ListChecks,
  HelpCircle,
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
  preview: string;
}

interface PendingPermission {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: number;
}

interface HookStatus {
  configured: boolean;
  globalConfigured: boolean;
  projectConfigured: boolean;
  hookScriptPath: string;
  globalSettingsPath: string;
  projectSettingsPath: string;
  cwd: string;
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
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([]);
  const [hookStatus, setHookStatus] = useState<HookStatus | null>(null);
  const [selectedModel, setSelectedModel] = useState<"opus" | "sonnet" | "haiku">("sonnet");
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState<"default" | "acceptEdits" | "plan" | "bypassPermissions">("default");
  const [permissionPopoverOpen, setPermissionPopoverOpen] = useState(false);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, Record<number, string>>>({});
  const respondedPermissionsRef = useRef<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pollingRef = useRef<number | null>(null);
  const permissionPollingRef = useRef<number | null>(null);
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

  const fetchHookStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/hook-status");
      const data = await res.json();
      if (data.success) {
        setHookStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch hook status:", error);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchHookStatus();
  }, [fetchHookStatus]);

  // Poll for pending permission requests
  useEffect(() => {
    const pollPermissions = async () => {
      try {
        const res = await fetch("/api/permission-pending");
        const data = await res.json();
        if (data.success) {
          // Filter out permissions we've already responded to
          // AND filter to only show permissions for current session (or no session for new chats)
          const filtered = data.pending.filter((p: PendingPermission) => {
            if (respondedPermissionsRef.current.has(p.id)) return false;
            // Show if session matches, or if we have no session yet (new chat)
            if (!currentSessionId) return true;
            return p.sessionId === currentSessionId;
          });
          setPendingPermissions(filtered);
        }
      } catch (err) {
        console.error("Failed to poll permissions:", err);
      }
    };

    // Poll every 3 seconds
    permissionPollingRef.current = window.setInterval(pollPermissions, 3000);
    pollPermissions();

    return () => {
      if (permissionPollingRef.current) {
        clearInterval(permissionPollingRef.current);
        permissionPollingRef.current = null;
      }
    };
  }, [currentSessionId]);

  const respondToPermission = async (id: string, allow: boolean) => {
    // Mark as responded immediately to prevent re-showing
    respondedPermissionsRef.current.add(id);

    // Remove from local state immediately
    setPendingPermissions((prev) => prev.filter((p) => p.id !== id));

    // Clean up any stored answers for this question
    setQuestionAnswers((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      await fetch("/api/permission-respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, allow }),
      });
    } catch (err) {
      console.error("Failed to respond to permission:", err);
    }

    // Clear from responded set after 10 seconds (cleanup)
    setTimeout(() => {
      respondedPermissionsRef.current.delete(id);
    }, 10000);
  };

  const submitQuestionAnswer = async (permId: string, questions: Array<{ question: string }>) => {
    const answers = questionAnswers[permId] || {};
    // Build answer string from selected options
    const answerParts: string[] = [];
    questions.forEach((q, idx) => {
      if (answers[idx]) {
        answerParts.push(answers[idx]);
      }
    });

    if (answerParts.length === 0) {
      return; // No answers selected
    }

    // Allow the question tool
    await respondToPermission(permId, true);

    // Send the answer as a user message
    const answerText = answerParts.join("\n");
    if (inputRef.current) {
      inputRef.current.value = answerText;
      setInput(answerText);
    }
    // Auto-send after a short delay
    setTimeout(() => {
      sendMessage();
    }, 100);
  };

  const selectQuestionOption = (permId: string, questionIdx: number, optionLabel: string) => {
    setQuestionAnswers((prev) => ({
      ...prev,
      [permId]: {
        ...(prev[permId] || {}),
        [questionIdx]: optionLabel,
      },
    }));
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }, 100);
  };

  // Track previous counts to detect new items
  const prevPermissionCountRef = useRef(0);
  const prevMessageCountRef = useRef(0);

  useEffect(() => {
    // Scroll when new messages are added
    if (messages.length > prevMessageCountRef.current) {
      scrollToBottom();
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    // Only scroll when new permission requests appear
    if (pendingPermissions.length > prevPermissionCountRef.current) {
      scrollToBottom();
    }
    prevPermissionCountRef.current = pendingPermissions.length;
  }, [pendingPermissions]);

  // Poll for streaming updates while loading (but not while waiting for permission)
  useEffect(() => {
    if (!isLoading || pendingPermissions.length > 0) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      if (!isLoading) return;
      // If waiting for permission, don't poll but don't return early
      if (pendingPermissions.length > 0) {
        console.log("[Polling] Paused - waiting for permission approval");
        return;
      }
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

    // Poll every 3 seconds
    pollingRef.current = window.setInterval(pollSession, 3000);
    // Also poll immediately
    pollSession();

    return () => {
      console.log("[Polling] Cleanup");
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isLoading, streamingSessionId, currentSessionId, pendingPermissions.length]);

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
    // Clear pending permissions from old session
    setPendingPermissions([]);
    setQuestionAnswers({});
    respondedPermissionsRef.current.clear();
  };

  const selectSession = async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setIsLoading(true);
    setSheetOpen(false);
    setVisibleCount(MESSAGES_PER_PAGE);
    // Clear pending permissions from old session
    setPendingPermissions([]);
    setQuestionAnswers({});
    respondedPermissionsRef.current.clear();

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
    scrollToBottom();

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: trimmed,
        ...(currentSessionId && { sessionId: currentSessionId }),
        requestId,
        permissionMode,
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
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted ${
                      currentSessionId === session.id ? "bg-muted" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-sm">
                        {session.preview}
                      </span>
                    </span>
                    <span className="pl-6 text-xs text-muted-foreground">
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

      {/* Setup Banner */}
      <SetupBanner hookStatus={hookStatus} onConfigured={fetchHookStatus} />


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

          {/* Permission Requests - Inline */}
          {pendingPermissions.map((perm) => {
            // Check if this is a plan approval (ExitPlanMode)
            const isPlanApproval = perm.toolName === "ExitPlanMode";
            const isQuestion = perm.toolName === "AskUserQuestion";
            const allowedPrompts = perm.toolInput.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined;
            const questions = perm.toolInput.questions as Array<{
              question: string;
              header: string;
              options: Array<{ label: string; description: string }>;
              multiSelect?: boolean;
            }> | undefined;

            // Question UI
            if (isQuestion && questions) {
              const selectedAnswers = questionAnswers[perm.id] || {};
              const allAnswered = questions.every((_, idx) => selectedAnswers[idx]);

              return (
                <div key={perm.id} className="flex items-start gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-500/20">
                    <HelpCircle className="h-4 w-4 text-purple-400" />
                  </div>
                  <Card className="flex-1 rounded-2xl border-purple-500/30 bg-purple-500/10 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <HelpCircle className="h-5 w-5 text-purple-400" />
                      <span className="text-lg font-medium text-purple-200">
                        Claude needs clarification
                      </span>
                    </div>
                    {questions.map((q, qIdx) => (
                      <div key={qIdx} className="mb-4">
                        <p className="mb-3 text-sm text-purple-100">
                          {q.question}
                        </p>
                        <div className="space-y-2">
                          {q.options.map((opt, optIdx) => {
                            const isSelected = selectedAnswers[qIdx] === opt.label;
                            return (
                              <button
                                key={optIdx}
                                type="button"
                                onClick={() => selectQuestionOption(perm.id, qIdx, opt.label)}
                                className={`w-full rounded-lg px-3 py-2 text-left transition-all ${
                                  isSelected
                                    ? "bg-purple-500/40 ring-2 ring-purple-400"
                                    : "bg-black/20 hover:bg-purple-500/20"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                    isSelected
                                      ? "border-purple-400 bg-purple-400"
                                      : "border-purple-400/50"
                                  }`}>
                                    {isSelected && <Check className="h-3 w-3 text-white" />}
                                  </div>
                                  <span className="font-medium text-purple-200">{opt.label}</span>
                                </div>
                                {opt.description && (
                                  <p className="mt-1 pl-6 text-xs text-purple-100/60">{opt.description}</p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 flex-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300"
                        onClick={() => respondToPermission(perm.id, false)}
                      >
                        <X className="mr-1.5 h-4 w-4" />
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        className="h-9 flex-1 bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50"
                        disabled={!allAnswered}
                        onClick={() => submitQuestionAnswer(perm.id, questions)}
                      >
                        <Send className="mr-1.5 h-4 w-4" />
                        Submit Answer
                      </Button>
                    </div>
                  </Card>
                </div>
              );
            }

            if (isPlanApproval) {
              return (
                <div key={perm.id} className="flex items-start gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/20">
                    <ListChecks className="h-4 w-4 text-blue-400" />
                  </div>
                  <Card className="flex-1 rounded-2xl border-blue-500/30 bg-blue-500/10 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <FileText className="h-5 w-5 text-blue-400" />
                      <span className="text-lg font-medium text-blue-200">
                        Plan Ready for Approval
                      </span>
                    </div>
                    <p className="mb-3 text-sm text-blue-100/70">
                      Claude has created an implementation plan. Review and approve to proceed with execution.
                    </p>
                    {allowedPrompts && allowedPrompts.length > 0 && (
                      <div className="mb-4">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-blue-300/70">
                          Requested Permissions
                        </p>
                        <div className="space-y-1.5">
                          {allowedPrompts.map((prompt, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2"
                            >
                              <Terminal className="h-3.5 w-3.5 text-blue-400" />
                              <span className="text-sm text-blue-100">{prompt.prompt}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 flex-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300"
                        onClick={() => respondToPermission(perm.id, false)}
                      >
                        <X className="mr-1.5 h-4 w-4" />
                        Reject Plan
                      </Button>
                      <Button
                        size="sm"
                        className="h-9 flex-1 bg-blue-600 text-white hover:bg-blue-500"
                        onClick={() => respondToPermission(perm.id, true)}
                      >
                        <Check className="mr-1.5 h-4 w-4" />
                        Approve Plan
                      </Button>
                    </div>
                  </Card>
                </div>
              );
            }

            // Regular permission request
            return (
              <div key={perm.id} className="flex items-start gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
                  <Shield className="h-4 w-4 text-amber-400" />
                </div>
                <Card className="flex-1 rounded-2xl border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-medium text-amber-200">
                      Permission Request
                    </span>
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">
                      {perm.toolName}
                    </span>
                  </div>
                  <div className="mb-3 rounded-lg bg-black/20 p-2 font-mono text-xs text-amber-100/80">
                    {perm.toolName === "Bash" && perm.toolInput.command
                      ? String(perm.toolInput.command)
                      : perm.toolName === "Edit" || perm.toolName === "Write"
                        ? String(perm.toolInput.file_path || "")
                        : perm.toolName === "Read"
                          ? String(perm.toolInput.file_path || "")
                          : JSON.stringify(perm.toolInput, null, 2)}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 flex-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300"
                      onClick={() => respondToPermission(perm.id, false)}
                    >
                      <X className="mr-1.5 h-4 w-4" />
                      Deny
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 flex-1 bg-green-600 text-white hover:bg-green-500"
                      onClick={() => respondToPermission(perm.id, true)}
                    >
                      <Check className="mr-1.5 h-4 w-4" />
                      Allow
                    </Button>
                  </div>
                </Card>
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 px-3 pb-4 pt-3 pb-safe">
        <div className="rounded-2xl bg-gradient-to-r from-blue-400/60 via-purple-500/60 to-violet-400/60 p-[1px]">
          <div className="rounded-2xl bg-zinc-900 p-3">
            {/* Input Row */}
            <div className="flex items-end gap-2">
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
                rows={1}
                className="min-h-[40px] max-h-[120px] flex-1 resize-none border-0 bg-transparent dark:bg-transparent p-0 text-base placeholder:text-muted-foreground/50 focus-visible:ring-0 shadow-none"
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={abortRequest}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/80 text-white transition-colors hover:bg-red-500 active:scale-95"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => sendMessage()}
                  disabled={!input.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white transition-all hover:from-blue-400 hover:to-purple-500 active:scale-95 disabled:opacity-40 disabled:hover:from-blue-500 disabled:hover:to-purple-600"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Bottom Row - Mode Selection */}
            <div className="mt-3 flex items-center justify-between">
              <Popover open={permissionPopoverOpen} onOpenChange={setPermissionPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-full bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <Shield className={`h-4 w-4 ${
                      permissionMode === "default" ? "text-green-500" :
                      permissionMode === "acceptEdits" ? "text-yellow-500" :
                      permissionMode === "plan" ? "text-blue-500" :
                      "text-red-500"
                    }`} />
                    <span>
                      {permissionMode === "default" && "Default"}
                      {permissionMode === "acceptEdits" && "Accept Edits"}
                      {permissionMode === "plan" && "Plan"}
                      {permissionMode === "bypassPermissions" && "Bypass"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 p-1">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => {
                        setPermissionMode("default");
                        setPermissionPopoverOpen(false);
                      }}
                      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted ${
                        permissionMode === "default" ? "bg-muted" : ""
                      }`}
                    >
                      <Shield className="h-4 w-4 text-green-500" />
                      <div className="flex flex-col items-start">
                        <span>Default</span>
                        <span className="text-xs text-muted-foreground">Ask for permissions</span>
                      </div>
                      {permissionMode === "default" && (
                        <Check className="ml-auto h-4 w-4 text-primary" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPermissionMode("acceptEdits");
                        setPermissionPopoverOpen(false);
                      }}
                      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted ${
                        permissionMode === "acceptEdits" ? "bg-muted" : ""
                      }`}
                    >
                      <Shield className="h-4 w-4 text-yellow-500" />
                      <div className="flex flex-col items-start">
                        <span>Accept Edits</span>
                        <span className="text-xs text-muted-foreground">Auto-approve file edits</span>
                      </div>
                      {permissionMode === "acceptEdits" && (
                        <Check className="ml-auto h-4 w-4 text-primary" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPermissionMode("plan");
                        setPermissionPopoverOpen(false);
                      }}
                      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted ${
                        permissionMode === "plan" ? "bg-muted" : ""
                      }`}
                    >
                      <Shield className="h-4 w-4 text-blue-500" />
                      <div className="flex flex-col items-start">
                        <span>Plan Mode</span>
                        <span className="text-xs text-muted-foreground">Read-only, no edits</span>
                      </div>
                      {permissionMode === "plan" && (
                        <Check className="ml-auto h-4 w-4 text-primary" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPermissionMode("bypassPermissions");
                        setPermissionPopoverOpen(false);
                      }}
                      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted ${
                        permissionMode === "bypassPermissions" ? "bg-muted" : ""
                      }`}
                    >
                      <Shield className="h-4 w-4 text-red-500" />
                      <div className="flex flex-col items-start">
                        <span>Bypass Permissions</span>
                        <span className="text-xs text-muted-foreground">Auto-approve everything</span>
                      </div>
                      {permissionMode === "bypassPermissions" && (
                        <Check className="ml-auto h-4 w-4 text-primary" />
                      )}
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
              <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-full bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <Bot className="h-4 w-4 text-purple-500" />
                    <span>
                      {selectedModel === "opus" && "Claude Opus"}
                      {selectedModel === "sonnet" && "Claude Sonnet"}
                      {selectedModel === "haiku" && "Claude Haiku"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-48 p-1">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedModel("opus");
                        setModelPopoverOpen(false);
                      }}
                      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted ${
                        selectedModel === "opus" ? "bg-muted" : ""
                      }`}
                    >
                      <Bot className="h-4 w-4 text-amber-500" />
                      <span>Claude Opus</span>
                      {selectedModel === "opus" && (
                        <Check className="ml-auto h-4 w-4 text-primary" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedModel("sonnet");
                        setModelPopoverOpen(false);
                      }}
                      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted ${
                        selectedModel === "sonnet" ? "bg-muted" : ""
                      }`}
                    >
                      <Bot className="h-4 w-4 text-purple-500" />
                      <span>Claude Sonnet</span>
                      {selectedModel === "sonnet" && (
                        <Check className="ml-auto h-4 w-4 text-primary" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedModel("haiku");
                        setModelPopoverOpen(false);
                      }}
                      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted ${
                        selectedModel === "haiku" ? "bg-muted" : ""
                      }`}
                    >
                      <Bot className="h-4 w-4 text-green-500" />
                      <span>Claude Haiku</span>
                      {selectedModel === "haiku" && (
                        <Check className="ml-auto h-4 w-4 text-primary" />
                      )}
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
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
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex min-w-0 max-w-[90%] flex-col gap-2 ${isUser ? "items-end" : ""}`}>
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
            <div
              className={`w-full break-words rounded-2xl px-4 py-3 ${
                isUser
                  ? "bg-indigo-950/90 text-indigo-100 ring-1 ring-indigo-800/50"
                  : "bg-zinc-800/80 text-zinc-100"
              }`}
            >
              {isUser ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="prose prose-sm prose-invert max-w-none [&_*]:break-words">
                  <Markdown content={message.content} />
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
});
