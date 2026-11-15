import type { DocumentRequest } from "../../lib/api";

export interface CloseCycle {
  id: string;
  status: string;
  workItems: { id: string; title: string; status: string }[];
}
export interface RequestThread {
  id: string;
  visibility: string;
  messages: {
    id: string;
    authorUserId: string;
    body: string;
    visibility: string;
    createdAt: string;
  }[];
}
export interface WorkDocumentRequest extends DocumentRequest {
  description?: string | null;
  dueDate?: string | null;
  threads?: RequestThread[];
}
export interface Obligation {
  id: string;
  status: string;
  dueDate: string | null;
  regime: {
    name: string;
    taxType: { name: string };
    jurisdiction: { name: string };
  };
  period: { id: string; label: string | null; startDate: string; endDate: string };
}
export interface EvidencePreview {
  url: string;
  mimeType: string | null;
  originalName: string | null;
}
