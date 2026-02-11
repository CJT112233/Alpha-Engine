import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Send, Bot, User, ArrowDownRight, Loader2, AlertCircle } from "lucide-react";
import type { UpifChatMessage } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AiThinking } from "@/components/ai-thinking";

interface UpifChatProps {
  scenarioId: string;
  hasUpif: boolean;
  isConfirmed: boolean;
}

export function UpifChat({ scenarioId, hasUpif, isConfirmed }: UpifChatProps) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages, isLoading, isError } = useQuery<UpifChatMessage[]>({
    queryKey: ["/api/scenarios", scenarioId, "upif", "chat"],
    enabled: hasUpif,
  });

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", `/api/scenarios/${scenarioId}/upif/chat`, { message });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "upif", "chat"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "upif"] });
      setInput("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!hasUpif) return null;

  return (
    <Card data-testid="card-upif-chat">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" />
          Reviewer Chat
          {messages && messages.length > 0 && (
            <Badge variant="secondary" className="text-xs" data-testid="badge-chat-count">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground" data-testid="text-chat-description">
          Suggest changes to unlocked UPIF fields using natural language. Locked fields will be preserved.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="min-h-[120px] max-h-[400px] overflow-y-auto space-y-3 rounded-md border p-3"
          data-testid="chat-messages-container"
        >
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-12 w-3/4 ml-auto" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="text-chat-error">
              <AlertCircle className="h-8 w-8 text-destructive mb-2" />
              <p className="text-sm text-muted-foreground">
                Failed to load chat messages. Please refresh the page.
              </p>
            </div>
          ) : !messages || messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="text-chat-empty">
              <Bot className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No messages yet. Type a suggestion to update the UPIF.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Example: "Change the location to Portland, Oregon" or "Add food waste as a secondary feedstock at 5,000 tons/year"
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`chat-message-${msg.role}-${msg.id}`}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                  data-testid={`text-chat-content-${msg.id}`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.role === "assistant" && msg.appliedUpdates && (msg.appliedUpdates as { changedFields: string[]; summary: string }).changedFields.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/50" data-testid={`chat-changes-${msg.id}`}>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                        <ArrowDownRight className="h-3 w-3" />
                        Changes applied:
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(msg.appliedUpdates as { changedFields: string[]; summary: string }).changedFields.map((field) => (
                          <Badge key={field} variant="secondary" className="text-xs" data-testid={`badge-changed-field-${field}`}>
                            {field}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          {sendMutation.isPending && (
            <div className="flex gap-2 justify-start" data-testid="chat-loading-indicator">
              <div className="flex-shrink-0 mt-0.5">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              </div>
              <div className="bg-muted rounded-md px-3 py-2">
                <AiThinking isActive={true} label="Reviewing your feedback..." compact />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {!isConfirmed && (
          <div className="flex gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Suggest a change to the UPIF..."
              className="resize-none text-sm min-h-[40px] max-h-[100px]"
              rows={1}
              disabled={sendMutation.isPending}
              data-testid="input-chat-message"
            />
            <Button
              size="icon"
              onClick={handleSubmit}
              disabled={!input.trim() || sendMutation.isPending}
              data-testid="button-send-chat"
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
