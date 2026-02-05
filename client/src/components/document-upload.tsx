import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { FileUp, File, FileText, Image, Trash2, Upload, CheckCircle2, AlertCircle } from "lucide-react";
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
        description: "Your document has been uploaded and is being processed.",
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
                Text extraction from PDFs and documents
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                OCR for scanned images
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                Automatic parameter recognition
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
            <ScrollArea className="h-[350px] pr-4">
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-start gap-3 p-3 rounded-md border bg-card"
                    data-testid={`document-${doc.id}`}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      {getFileIcon(doc.mimeType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{doc.originalName}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatFileSize(doc.size)}</span>
                        <span>-</span>
                        <span>{format(new Date(doc.createdAt), "MMM d, h:mm a")}</span>
                      </div>
                      {doc.extractedText && (
                        <Badge variant="secondary" className="mt-2 text-xs">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Text extracted
                        </Badge>
                      )}
                    </div>
                    {!isLocked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
