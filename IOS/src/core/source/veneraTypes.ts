export type VeneraOperation =
  | 'init'
  | 'search'
  | 'loadInfo'
  | 'loadEp'
  | 'onImageLoad'
  | 'onThumbnailLoad'
  | 'isLoggedIn'
  | 'getBaseUrl'
  | 'rawCall';

export interface VeneraSearchParams {
  keyword: string;
  options?: string[];
  page?: number;
}

export interface VeneraLoadInfoParams {
  bookId: string;
}

export interface VeneraLoadEpParams {
  comicId: string;
  epId: string;
}

export interface VeneraOnImageLoadParams {
  url: string;
  comicId?: string;
  epId?: string;
  nl?: string;
}

export interface VeneraOnThumbnailLoadParams {
  url: string;
}

export interface VeneraRawCallParams {
  expression: string;
}

export interface VeneraOperationParams {
  operation: VeneraOperation;
  keyword?: string;
  options?: string[];
  page?: number;
  bookId?: string;
  comicId?: string;
  epId?: string;
  url?: string;
  nl?: string;
  expression?: string;
}

export interface VeneraComic {
  id: string;
  title: string;
  subtitle?: string;
  cover?: string;
  tags?: string[] | Record<string, string[]>;
  description?: string;
  maxPage?: number;
  language?: string;
  favoriteId?: string;
  stars?: number;
  author?: string;
  status?: string;
  isCompleted?: boolean;
  alternateTitles?: string[];
  aliases?: string[];
  otherNames?: string[];
  originalLanguage?: string;
  updatedAt?: string;
}

export interface VeneraChapter {
  id: string;
  title: string;
  order?: number;
  group?: string;
}

export interface VeneraComicDetails {
  title: string;
  subtitle?: string;
  cover?: string;
  description?: string;
  chapters: VeneraChapter[];
  tags?: Record<string, string[]> | string[];
  isFavorite?: boolean;
  subId?: string;
  thumbnails?: string[];
  recommend?: VeneraComic[];
  commentCount?: number;
  likesCount?: number;
  isLiked?: boolean;
  uploader?: string;
  updateTime?: string;
  uploadTime?: string;
  url?: string;
  stars?: number;
  maxPage?: number;
  author?: string;
  status?: string;
  comments?: unknown[];
}

export interface VeneraSearchResult {
  comics: VeneraComic[];
  maxPage: number;
  hasMore?: boolean;
}

export interface VeneraChapterImages {
  images: string[];
}

export interface VeneraImageConfig {
  url?: string;
  headers?: Record<string, string>;
  referer?: string;
  modifyImage?: string;
  nl?: string;
}

export interface VeneraSimpleResult {
  logged?: boolean;
  baseUrl?: string;
  value?: unknown;
}

export type VeneraOperationResult =
  | VeneraSearchResult
  | VeneraComicDetails
  | VeneraChapterImages
  | VeneraImageConfig
  | VeneraSimpleResult;

export interface VeneraEvaluateRequest {
  type: 'evaluate';
  id: number;
  script: string;
  sourceKey: string;
  operation: VeneraOperation;
  params: VeneraOperationParams;
}

export interface VeneraHostResponse {
  type: 'host-response';
  requestId: number;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type VeneraWorkerRequest = VeneraEvaluateRequest | VeneraHostResponse;

export interface VeneraResultSuccess {
  type: 'result';
  id: number;
  ok: true;
  operation: VeneraOperation;
  data: VeneraOperationResult;
}

export interface VeneraResultError {
  type: 'result';
  id: number;
  ok: false;
  operation: VeneraOperation;
  error: string;
}

export interface VeneraHostRequest {
  type: 'host-request';
  requestId: number;
  method: string;
  params: Record<string, unknown>;
}

export interface VeneraLogMessage {
  type: 'log';
  level: 'info' | 'warning' | 'error';
  title: string;
  content: string;
}

export type VeneraWorkerResponse =
  | VeneraResultSuccess
  | VeneraResultError
  | VeneraHostRequest
  | VeneraLogMessage;

export interface VeneraSendMessageRequest {
  method: string;
  [key: string]: unknown;
}

export interface VeneraCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export interface VeneraHttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string | ArrayBuffer;
}

export type VeneraWorkerFactory = () => Worker;

export interface VeneraWorkerHandle {
  send(
    request: Omit<VeneraEvaluateRequest, 'id'>,
    timeoutMs?: number,
  ): Promise<VeneraResultSuccess | VeneraResultError>;
  terminate(): void;
}

export const VENERA_WORKER_TIMEOUT_MS = 45_000;
