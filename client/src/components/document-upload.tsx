import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileUp, File, FileText, Image, Trash2, Upload, CheckCircle2, AlertCircle, Eye, ChevronDown, ChevronUp } from "lucide-react";
import type { Document } from "@shared/schema";
import { format } from "date-fns";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DocumentUploadProps {
  scenarioId: string;
  documents: Document[];
  isLoading: boolean;
  isLocked: boolean;
}

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
  if (mimeType.startsWith("image/")) return <Image className="h-5 w-5" />;
  if (mimeType === "application/pdf") return <FileText className="h-5 w-5" />;
  return <File className="h-5 w-5" />;
};

const supportedFormats = [
  { type: "PDF Documents", ext: ".pdf" },
  { type: "Word Documents", ext: ".docx, .doc" },
  { type: "Excel Spreadsheets", ext: ".xlsx, .xls" },
  { type: "Images", ext: ".jpg, .png, .tiff" },
  { type: "Text Files", ext: ".txt, .csv" },
];

export function DocumentUpload({ scenarioId, documents, isLoading, isLocked }: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/scenarios/${scenarioId}/documents`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "documents"] });
      toast({
        title: "Document uploaded",
        description: "Your document has been uploaded and text has been extracted.",
      });
    },
    onError: () => {
      toast({
        title: "Upload failed",
        description: "Failed to upload document. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Delete failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "documents"] });
      toast({
        title: "Document deleted",
        description: "The document has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete document. Please try again.",
        variant: "destructive",
      });
    },
  });

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
    files.forEach((file) => uploadMutation.mutate(file));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => uploadMutation.mutate(file));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleExpanded = (docId: string) => {
    setExpandedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            Document Upload
          </CardTitle>
          <CardDescription>
            Upload engineering reports, permits, specifications, lab results, and other project documents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLocked ? (
            <>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-primary/50"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                <p className="font-medium mb-1">Drag and drop files here</p>
                <p className="text-sm text-muted-foreground mb-4">or click to browse</p>
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
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending}
                  data-testid="button-browse-files"
                >
                  {uploadMutation.isPending ? "Uploading..." : "Browse Files"}
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Supported Formats</p>
                <div className="flex flex-wrap gap-2">
                  {supportedFormats.map((format) => (
                    <Badge key={format.type} variant="secondary" className="text-xs">
                      {format.ext}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="p-4 rounded-md bg-muted text-muted-foreground text-sm">
              This scenario is confirmed. Documents cannot be modified.
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Document Processing</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                Text extraction from PDFs, Word, and Excel
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                Table structure preservation
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                Automatic parameter recognition via AI
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded Documents</CardTitle>
          <CardDescription>
            {documents.length === 0
              ? "Your uploaded files will appear here"
              : `${documents.length} document${documents.length === 1 ? "" : "s"} uploaded`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileUp className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No documents uploaded. Drag files or click browse above.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {documents.map((doc) => {
                  const hasText = !!(doc.extractedText && doc.extractedText.trim());
                  const charCount = hasText ? doc.extractedText!.length : 0;
                  const isExpanded = expandedDocs.has(doc.id);
                  const previewText = hasText
                    ? doc.extractedText!.substring(0, 300) + (doc.extractedText!.length > 300 ? "..." : "")
                    : null;

                  return (
                    <div
                      key={doc.id}
                      className="p-3 rounded-md border bg-card"
                      data-testid={`document-${doc.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                          {getFileIcon(doc.mimeType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate" data-testid={`text-doc-name-${doc.id}`}>{doc.originalName}</p>
                          <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{formatFileSize(doc.size)}</span>
                            <span>-</span>
                            <span>{format(new Date(doc.createdAt), "MMM d, h:mm a")}</span>
                          </div>
                          <div className="flex items-center flex-wrap gap-2 mt-2">
                            {hasText ? (
                              <Badge variant="secondary" className="text-xs" data-testid={`badge-extracted-${doc.id}`}>
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Text extracted ({formatNumber(charCount)} chars)
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground" data-testid={`badge-no-text-${doc.id}`}>
                                <AlertCircle className="h-3 w-3 mr-1" />
                                No text extracted
                              </Badge>
                            )}
                            {hasText && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => setPreviewDoc(doc)}
                                data-testid={`button-preview-${doc.id}`}
                              >
                                <Eye className="h-3 w-3 mr-1" />
                                Preview
                              </Button>
                            )}
                          </div>
                        </div>
                        {!isLocked && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground"
                            onClick={() => {
                              if (confirm("Delete this document?")) {
                                deleteMutation.mutate(doc.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-document-${doc.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {hasText && (
                        <div className="mt-2 ml-[52px]">
                          <button
                            className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer"
                            onClick={() => toggleExpanded(doc.id)}
                            data-testid={`button-toggle-preview-${doc.id}`}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                            {isExpanded ? "Hide snippet" : "Show snippet"}
                          </button>
                          {isExpanded && (
                            <div className="mt-1 p-2 rounded bg-muted text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-[120px] overflow-y-auto" data-testid={`text-snippet-${doc.id}`}>
                              {previewText}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

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
