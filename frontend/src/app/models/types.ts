export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export interface AuthConfig {
  google_client_id: string | null;
  allow_registration: boolean;
}

export interface ChatSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface HistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  created_at: string;
}

export interface DocumentMeta {
  id: string;
  filename: string;
  author: string | null;
  year: number | null;
  topic: string | null;
  status: 'processing' | 'ready' | 'failed';
  num_pages: number;
  uploaded_at: string;
}

export interface Citation {
  marker: number;
  filename: string;
  page_num: number;
  doc_id: string;
  highlighted_sentence: string;
}

export interface RetrievedChunk {
  child_id: string;
  page_num: number;
  text: string;
  filename: string;
}

export interface EvalTrace {
  message_id: string;
  final_answer: string;
  retrieved_chunks: RetrievedChunk[];
  llm_context: string;
  citations: Citation[];
}
