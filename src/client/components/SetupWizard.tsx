import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Shield, Settings, Check, Copy, Loader2, AlertTriangle } from "lucide-react";

interface HookStatus {
  configured: boolean;
  globalConfigured: boolean;
  projectConfigured: boolean;
  hookScriptPath: string;
  globalSettingsPath: string;
  projectSettingsPath: string;
  cwd: string;
}

interface SetupWizardProps {
  hookStatus: HookStatus | null;
  onConfigured: () => void;
}

export function SetupBanner({ hookStatus, onConfigured }: SetupWizardProps) {
  const [wizardOpen, setWizardOpen] = useState(false);

  if (!hookStatus || hookStatus.configured) return null;

  return (
    <>
      <div className="shrink-0 border-b bg-yellow-500/10 p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-500/20">
            <AlertTriangle className="h-4 w-4 text-yellow-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-yellow-200">Permission System Not Configured</p>
            <p className="text-xs text-yellow-300/70">
              Tool approvals won't work until you set up the permission hook
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0 bg-yellow-500/80 text-black hover:bg-yellow-500"
            onClick={() => setWizardOpen(true)}
          >
            <Settings className="mr-1.5 h-4 w-4" />
            Setup
          </Button>
        </div>
      </div>

      <SetupWizardDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        hookStatus={hookStatus}
        onConfigured={() => {
          setWizardOpen(false);
          onConfigured();
        }}
      />
    </>
  );
}

interface SetupWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hookStatus: HookStatus;
  onConfigured: () => void;
}

function SetupWizardDialog({ open, onOpenChange, hookStatus, onConfigured }: SetupWizardDialogProps) {
  const [step, setStep] = useState<"choose" | "manual" | "auto">("choose");
  const [configuring, setConfiguring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const configJson = JSON.stringify(
    {
      hooks: {
        PermissionRequest: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: hookStatus.hookScriptPath,
              },
            ],
          },
        ],
      },
    },
    null,
    2
  );

  const handleAutoConfigure = async (location: "global" | "project") => {
    setConfiguring(true);
    setError(null);

    try {
      const res = await fetch("/api/hook-configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location }),
      });
      const data = await res.json();

      if (data.success) {
        onConfigured();
      } else {
        setError(data.error || "Failed to configure");
      }
    } catch (err) {
      setError("Failed to connect to server");
    } finally {
      setConfiguring(false);
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(configJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Setup Permission System
          </SheetTitle>
          <SheetDescription>
            Configure Claude to send permission requests to this chat interface
          </SheetDescription>
        </SheetHeader>

        {step === "choose" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The permission system requires a hook in Claude's settings. This hook
              intercepts permission prompts and sends them here for your approval.
            </p>

            <div className="grid gap-3">
              <Card
                className="cursor-pointer p-4 hover:bg-muted/50"
                onClick={() => setStep("auto")}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
                    <Check className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium">Automatic Setup</p>
                    <p className="text-sm text-muted-foreground">
                      Let us configure it for you (recommended)
                    </p>
                  </div>
                </div>
              </Card>

              <Card
                className="cursor-pointer p-4 hover:bg-muted/50"
                onClick={() => setStep("manual")}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                    <Settings className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="font-medium">Manual Setup</p>
                    <p className="text-sm text-muted-foreground">
                      See the configuration and set it up yourself
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {step === "auto" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose where to add the hook configuration:
            </p>

            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="grid gap-3">
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">Global Settings</p>
                    <p className="text-xs text-muted-foreground">
                      {hookStatus.globalSettingsPath}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Works for all projects
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleAutoConfigure("global")}
                    disabled={configuring}
                  >
                    {configuring ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Configure"
                    )}
                  </Button>
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">Project Settings</p>
                    <p className="text-xs text-muted-foreground">
                      {hookStatus.projectSettingsPath}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Only for this project
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAutoConfigure("project")}
                    disabled={configuring}
                  >
                    {configuring ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Configure"
                    )}
                  </Button>
                </div>
              </Card>
            </div>

            <Button variant="ghost" className="w-full" onClick={() => setStep("choose")}>
              Back
            </Button>
          </div>
        )}

        {step === "manual" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add this to your Claude settings file:
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Global: {hookStatus.globalSettingsPath}</span>
                <span>or</span>
                <span>Project: {hookStatus.projectSettingsPath}</span>
              </div>

              <div className="relative">
                <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">
                  {configJson}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute right-2 top-2"
                  onClick={copyToClipboard}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              If the file already exists, merge the hooks section with your existing
              configuration.
            </p>

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setStep("choose")}>
                Back
              </Button>
              <Button className="flex-1" onClick={onConfigured}>
                Done
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
