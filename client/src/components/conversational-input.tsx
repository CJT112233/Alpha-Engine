import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, MessageSquare, MapPin, Beaker, Settings2, FileOutput, Trash2, Pencil, Check, X } from "lucide-react";
import type { TextEntry } from "@shared/schema";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ConversationalInputProps {
  scenarioId: string;
  entries: TextEntry[];
  isLoading: boolean;
  isLocked: boolean;
}

const categoryIcons: Record<string, React.ReactNode> = {
  feedstock: <Beaker className="h-3.5 w-3.5" />,
  output_requirements: <FileOutput className="h-3.5 w-3.5" />,
  location: <MapPin className="h-3.5 w-3.5" />,
  constraints: <Settings2 className="h-3.5 w-3.5" />,
};

const categoryLabels: Record<string, string> = {
  feedstock: "Feedstock",
  output_requirements: "Output",
  location: "Location",
  constraints: "Constraints",
};

export function ConversationalInput({ scenarioId, entries, isLoading, isLocked }: ConversationalInputProps) {
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const { toast } = useToast();

  const addEntryMutation = useMutation({
    mutationFn: async (content: string) => {
      return apiRequest("POST", `/api/scenarios/${scenarioId}/text-entries`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "text-entries"] });
      setContent("");
      toast({
        title: "Input added",
        description: "Your project information has been captured.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add input. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      return apiRequest("PATCH", `/api/text-entries/${id}`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "text-entries"] });
      setEditingId(null);
      setEditContent("");
      toast({
        title: "Entry updated",
        description: "Your text entry has been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update entry. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      return apiRequest("DELETE", `/api/text-entries/${entryId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "text-entries"] });
      toast({
        title: "Entry deleted",
        description: "The text entry has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete entry. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim() && !isLocked) {
      addEntryMutation.mutate(content.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const startEditing = (entry: TextEntry) => {
    setEditingId(entry.id);
    setEditContent(entry.content);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditContent("");
  };

  const saveEdit = (id: string) => {
    if (editContent.trim()) {
      updateEntryMutation.mutate({ id, content: editContent.trim() });
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit(id);
    }
    if (e.key === "Escape") {
      cancelEditing();
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Conversational Input
          </CardTitle>
          <CardDescription>
            Describe your project in natural language. Include feedstock details, output requirements, location, and any constraints.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-2">What you can describe:</p>
              <ul className="space-y-1.5">
                <li className="flex items-center gap-2">
                  <Beaker className="h-3.5 w-3.5 text-primary" />
                  <span>Feedstock type, volume, and technical specs</span>
                </li>
                <li className="flex items-center gap-2">
                  <FileOutput className="h-3.5 w-3.5 text-primary" />
                  <span>Output requirements (RNG, land application, etc.)</span>
                </li>
                <li className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-primary" />
                  <span>Project location</span>
                </li>
                <li className="flex items-center gap-2">
                  <Settings2 className="h-3.5 w-3.5 text-primary" />
                  <span>Constraints and assumptions</span>
                </li>
              </ul>
            </div>
          </div>

          {!isLocked && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Example: 100,000 tons per year of potato waste from processing facility in Quincy, Washington. Looking to produce RNG and land apply digestate. Budget of $15M for construction..."
                className="min-h-[120px] resize-none"
                data-testid="textarea-project-input"
              />
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">
                  Press Enter to submit, Shift+Enter for new line
                </p>
                <Button
                  type="submit"
                  disabled={!content.trim() || addEntryMutation.isPending}
                  data-testid="button-submit-input"
                >
                  <Send className="h-4 w-4 mr-2" />
                  {addEntryMutation.isPending ? "Adding..." : "Add Input"}
                </Button>
              </div>
            </form>
          )}

          {isLocked && (
            <div className="p-4 rounded-md bg-muted text-muted-foreground text-sm">
              This scenario is confirmed. Inputs cannot be modified.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Captured Inputs</CardTitle>
          <CardDescription>
            {entries.length === 0
              ? "Your project descriptions will appear here"
              : `${entries.length} input${entries.length === 1 ? "" : "s"} captured`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No inputs yet. Start describing your project above.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[350px] pr-4">
              <div className="space-y-3">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-md border bg-card"
                    data-testid={`entry-${entry.id}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(entry.createdAt), "MMM d, h:mm a")}
                        </span>
                        {entry.category && (
                          <Badge variant="secondary" className="text-xs">
                            {categoryIcons[entry.category]}
                            <span className="ml-1">{categoryLabels[entry.category]}</span>
                          </Badge>
                        )}
                      </div>
                      {!isLocked && (
                        <div className="flex items-center gap-1">
                          {editingId === entry.id ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-primary"
                                onClick={() => saveEdit(entry.id)}
                                disabled={updateEntryMutation.isPending || !editContent.trim()}
                                data-testid={`button-save-entry-${entry.id}`}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={cancelEditing}
                                disabled={updateEntryMutation.isPending}
                                data-testid={`button-cancel-edit-${entry.id}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-primary"
                                onClick={() => startEditing(entry)}
                                data-testid={`button-edit-entry-${entry.id}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  if (confirm("Delete this entry?")) {
                                    deleteEntryMutation.mutate(entry.id);
                                  }
                                }}
                                disabled={deleteEntryMutation.isPending}
                                data-testid={`button-delete-entry-${entry.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {editingId === entry.id ? (
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={(e) => handleEditKeyDown(e, entry.id)}
                        className="min-h-[60px] text-sm resize-none"
                        autoFocus
                        data-testid={`textarea-edit-entry-${entry.id}`}
                      />
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
