import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Send,
  Paperclip,
  Mic,
  MicOff,
  X,
  Trash2,
  Pencil,
  Check,
  FileText,
  File,
  Image,
  Eye,
  MessageSquare,
  FileUp,
  MapPin,
  Beaker,
  Settings2,
  FileOutput,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { TextEntry, Document } from "@shared/schema";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UnifiedInputProps {
  scenarioId: string;
  entries: TextEntry[];
  documents: Document[];
  isEntriesLoading: boolean;
  isDocumentsLoading: boolean;
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

function formatNumber(n: number): string {
  return n.toLocaleString();
}

const formatFileSize = (bytes: string | number) => {
  const size = typeof bytes === "string" ? parseInt(bytes) : bytes;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith("image/")) return <Image className="h-4 w-4" />;
  if (mimeType === "application/pdf") return <FileText className="h-4 w-4" />;
  return <File className="h-4 w-4" />;
};

type TimelineItem =
  | { type: "entry"; data: TextEntry; timestamp: Date }
  | { type: "document"; data: Document; timestamp: Date };

function buildTimeline(entries: TextEntry[], documents: Document[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...entries.map((e) => ({ type: "entry" as const, data: e, timestamp: new Date(e.createdAt) })),
    ...documents.map((d) => ({ type: "document" as const, data: d, timestamp: new Date(d.createdAt) })),
  ];
  items.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return items;
}

export function UnifiedInput({
  scenarioId,
  entries,
  documents,
  isEntriesLoading,
  isDocumentsLoading,
  isLocked,
}: UnifiedInputProps) {
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();

  const isLoading = isEntriesLoading || isDocumentsLoading;
  const timeline = buildTimeline(entries, documents);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [timeline.length]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, []);

  useEffect(() => {
    autoResize();
  }, [content, autoResize]);

  const addEntryMutation = useMutation({
    mutationFn: async (text: string) => {
      return apiRequest("POST", `/api/scenarios/${scenarioId}/text-entries`, { content: text });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "text-entries"] });
      setContent("");
      toast({ title: "Input added", description: "Your project information has been captured." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add input. Please try again.", variant: "destructive" });
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, content: text }: { id: string; content: string }) => {
      return apiRequest("PATCH", `/api/text-entries/${id}`, { content: text });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "text-entries"] });
      setEditingId(null);
      setEditContent("");
      toast({ title: "Entry updated", description: "Your text entry has been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update entry. Please try again.", variant: "destructive" });
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      return apiRequest("DELETE", `/api/text-entries/${entryId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "text-entries"] });
      toast({ title: "Entry deleted", description: "The text entry has been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete entry.", variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/scenarios/${scenarioId}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "documents"] });
      toast({ title: "Document uploaded", description: "Your document has been uploaded and text extracted." });
    },
    onError: () => {
      toast({ title: "Upload failed", description: "Failed to upload document. Please try again.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "documents"] });
      toast({ title: "Document deleted", description: "The document has been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete document.", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (isLocked) return;

    if (content.trim()) {
      addEntryMutation.mutate(content.trim());
    }

    pendingFiles.forEach((file) => uploadMutation.mutate(file));
    setPendingFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setPendingFiles((prev) => [...prev, ...files]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isLocked) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isLocked) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setPendingFiles((prev) => [...prev, ...files]);
    }
  };

  const supportsVoice = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const toggleVoice = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ title: "Not supported", description: "Voice input is not supported in this browser.", variant: "destructive" });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = content;

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += (finalTranscript ? " " : "") + transcript;
          setContent(finalTranscript);
        } else {
          interim += transcript;
        }
      }
      if (interim) {
        setContent(finalTranscript + (finalTranscript ? " " : "") + interim);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsRecording(false);
      if (event.error !== "aborted") {
        toast({ title: "Voice error", description: `Speech recognition error: ${event.error}`, variant: "destructive" });
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
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

  const toggleExpanded = (docId: string) => {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const hasContent = content.trim().length > 0 || pendingFiles.length > 0;
  const isBusy = addEntryMutation.isPending || uploadMutation.isPending;

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-1 pb-4"
        style={{ minHeight: 0 }}
      >
        {isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Describe your project</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Type or speak your project details below. You can also attach documents like engineering reports, permits, or lab results.
            </p>
            <div className="flex flex-wrap justify-center gap-3 mt-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-full">
                <Beaker className="h-3 w-3 text-primary" /> Feedstocks
              </span>
              <span className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-full">
                <FileOutput className="h-3 w-3 text-primary" /> Outputs
              </span>
              <span className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-full">
                <MapPin className="h-3 w-3 text-primary" /> Location
              </span>
              <span className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-full">
                <Settings2 className="h-3 w-3 text-primary" /> Constraints
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {timeline.map((item) => {
              if (item.type === "entry") {
                const entry = item.data;
                const isEditing = editingId === entry.id;
                return (
                  <div
                    key={`entry-${entry.id}`}
                    className="group flex gap-3 px-2"
                    data-testid={`entry-${entry.id}`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                      <MessageSquare className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(entry.createdAt), "MMM d, h:mm a")}
                        </span>
                        {entry.category && (
                          <Badge variant="secondary" className="text-xs h-5">
                            {categoryIcons[entry.category]}
                            <span className="ml-1">{categoryLabels[entry.category]}</span>
                          </Badge>
                        )}
                        {!isLocked && !isEditing && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-primary"
                              onClick={() => startEditing(entry)}
                              data-testid={`button-edit-entry-${entry.id}`}
                            >
                              <Pencil className="h-3 w-3" />
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
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            onKeyDown={(e) => handleEditKeyDown(e, entry.id)}
                            className="w-full min-h-[60px] p-2 text-sm rounded-md border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                            autoFocus
                            data-testid={`textarea-edit-entry-${entry.id}`}
                          />
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => saveEdit(entry.id)}
                              disabled={updateEntryMutation.isPending || !editContent.trim()}
                              data-testid={`button-save-entry-${entry.id}`}
                            >
                              <Check className="h-3 w-3 mr-1" /> Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={cancelEditing}
                              disabled={updateEntryMutation.isPending}
                              data-testid={`button-cancel-edit-${entry.id}`}
                            >
                              <X className="h-3 w-3 mr-1" /> Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg bg-muted/50 px-3 py-2">
                          <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              const doc = item.data;
              const hasText = !!(doc.extractedText && doc.extractedText.trim());
              const charCount = hasText ? doc.extractedText!.length : 0;
              const isExpanded = expandedDocs.has(doc.id);
              const previewText = hasText
                ? doc.extractedText!.substring(0, 300) + (doc.extractedText!.length > 300 ? "..." : "")
                : null;

              return (
                <div
                  key={`doc-${doc.id}`}
                  className="group flex gap-3 px-2"
                  data-testid={`document-${doc.id}`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 mt-0.5">
                    <FileUp className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(doc.createdAt), "MMM d, h:mm a")}
                      </span>
                      {!isLocked && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              if (confirm("Delete this document?")) {
                                deleteMutation.mutate(doc.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-document-${doc.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border bg-card px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                          {getFileIcon(doc.mimeType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate" data-testid={`text-doc-name-${doc.id}`}>
                            {doc.originalName}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatFileSize(doc.size)}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {hasText && (
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-extracted-${doc.id}`}>
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {formatNumber(charCount)} chars
                            </Badge>
                          )}
                          {!hasText && (
                            <Badge variant="outline" className="text-xs text-muted-foreground" data-testid={`badge-no-text-${doc.id}`}>
                              <AlertCircle className="h-3 w-3 mr-1" />
                              No text
                            </Badge>
                          )}
                          {hasText && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setPreviewDoc(doc)}
                              data-testid={`button-preview-${doc.id}`}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {hasText && (
                        <div className="mt-2 pt-2 border-t">
                          <button
                            className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                            onClick={() => toggleExpanded(doc.id)}
                            data-testid={`button-toggle-preview-${doc.id}`}
                          >
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {isExpanded ? "Hide extracted text" : "Show extracted text"}
                          </button>
                          {isExpanded && (
                            <div
                              className="mt-1.5 p-2 rounded bg-muted text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-[120px] overflow-y-auto"
                              data-testid={`text-snippet-${doc.id}`}
                            >
                              {previewText}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isDragging && (
        <div className="absolute inset-0 bg-primary/5 border-2 border-dashed border-primary rounded-lg z-10 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <FileUp className="h-10 w-10 text-primary mx-auto mb-2" />
            <p className="text-sm font-medium text-primary">Drop files here</p>
          </div>
        </div>
      )}

      {!isLocked && (
        <div className="border-t pt-3 mt-auto">
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 px-1">
              {pendingFiles.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 bg-muted rounded-md px-2.5 py-1.5 text-xs"
                  data-testid={`pending-file-${i}`}
                >
                  <Paperclip className="h-3 w-3 text-muted-foreground" />
                  <span className="max-w-[150px] truncate">{file.name}</span>
                  <button
                    className="text-muted-foreground hover:text-destructive ml-0.5"
                    onClick={() => removePendingFile(i)}
                    data-testid={`button-remove-pending-${i}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe your project... feedstocks, location, outputs, constraints"
                className="w-full min-h-[44px] max-h-[160px] py-2.5 pl-3 pr-20 text-sm rounded-lg border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                rows={1}
                data-testid="textarea-project-input"
              />
              <div className="absolute right-2 bottom-2 flex items-center gap-0.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png,.tiff"
                  data-testid="input-file-upload"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach files"
                  data-testid="button-attach-file"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                {supportsVoice && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${isRecording ? "text-red-500 animate-pulse" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={toggleVoice}
                    title={isRecording ? "Stop recording" : "Start voice input"}
                    data-testid="button-voice-input"
                  >
                    {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={!hasContent || isBusy}
              size="icon"
              className="h-[44px] w-[44px] shrink-0 rounded-lg"
              data-testid="button-submit-input"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center justify-between mt-1.5 px-1">
            <p className="text-xs text-muted-foreground">
              Enter to send{supportsVoice ? " · Click mic for voice" : ""} · Shift+Enter for new line
            </p>
            {isRecording && (
              <span className="text-xs text-red-500 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                Listening...
              </span>
            )}
          </div>
        </div>
      )}

      {isLocked && (
        <div className="border-t pt-3 mt-auto">
          <div className="p-3 rounded-md bg-muted text-muted-foreground text-sm text-center">
            This scenario is confirmed. Inputs cannot be modified.
          </div>
        </div>
      )}

      <Dialog open={!!previewDoc} onOpenChange={(open) => { if (!open) setPreviewDoc(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Extracted Text
            </DialogTitle>
            <DialogDescription>
              {previewDoc?.originalName} — {previewDoc?.extractedText ? formatNumber(previewDoc.extractedText.length) : 0} characters extracted
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh] mt-2">
            <pre className="text-sm whitespace-pre-wrap font-mono p-4 bg-muted rounded-md" data-testid="text-extracted-preview">
              {previewDoc?.extractedText || "No text available"}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
