import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response as ExpressResponse } from 'express';
import multer from 'multer';

type Provider = 'happyhorse' | 'seedance';
type MediaKind = 'video' | 'image' | 'audio' | string;
type TaskStatus = string | undefined;

interface Asset {
  id?: string;
  name?: string;
  type?: string;
  size?: number;
  kind?: MediaKind;
  url?: string;
}

interface GenerationParameters {
  resolution?: string;
  watermark?: boolean;
  ratio?: string;
  duration?: string | number;
  seed?: string | number;
}

interface GenerateBody {
  provider?: Provider;
  apiKey?: string;
  prompt?: string;
  assets?: Asset[];
  parameters?: GenerationParameters;
  model?: string;
}

interface TaskBody {
  apiKey?: string;
}

interface HappyHorsePayload {
  model: 'happyhorse-1.0-video-edit';
  input: {
    prompt: string;
    media: Array<{ type: 'video' | 'reference_image'; url: string }>;
  };
  parameters: {
    resolution: string;
    watermark: boolean;
    duration?: number;
    seed?: number;
  };
}

type SeedanceContent =
  | { type: 'text'; text: string }
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'audio_url'; audio_url: { url: string } };

interface SeedancePayload {
  model: string;
  content: SeedanceContent[];
  resolution?: string;
  duration?: number;
  ratio?: string;
  seed?: number;
}

type ApiPayload = Record<string, unknown>;

class UpstreamError extends Error {
  status?: number;
  payload?: unknown;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');

const app = express();
const port = Number(process.env.PORT || 5177);
const uploadDir = path.join(appRoot, 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path
      .basename(file.originalname || 'asset', ext)
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
      .slice(0, 48);
    cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 }
});

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadDir, {
  setHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));
app.use(express.static(path.join(appRoot, 'public')));

const okStatuses = new Set(['SUCCEEDED', 'succeeded', 'completed', 'success']);
const runningStatuses = new Set(['PENDING', 'RUNNING', 'queued', 'running', 'processing', 'in_progress']);

function isRecord(value: unknown): value is ApiPayload {
  return typeof value === 'object' && value !== null;
}

function getRecord(value: unknown, key: string): ApiPayload | undefined {
  if (!isRecord(value)) return undefined;
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function getString(value: unknown, pathParts: string[]): string | undefined {
  let cursor: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function publicBaseUrl(req: Request): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function sanitizeOriginalName(name: string): string {
  try {
    const buf = Buffer.from(name, 'latin1');
    const decoded = buf.toString('utf-8');
    if (!decoded.includes('\ufffd')) return decoded;
  } catch { /* keep original */ }
  return name;
}

function authKey(bodyKey: string | undefined, envKeyName: string): string {
  return (bodyKey || process.env[envKeyName] || '').trim();
}

function ensureUrl(asset: Asset): string {
  if (!asset.url) {
    throw new Error(`素材 ${asset.name || ''} 缺少可访问 URL`);
  }
  return asset.url;
}

function isKind(asset: Asset, kind: 'video' | 'image' | 'audio'): boolean {
  return asset.kind === kind || Boolean(asset.type?.startsWith(`${kind}/`));
}

function pickFirstAsset(assets: Asset[], kind: 'video' | 'image' | 'audio'): Asset | undefined {
  return assets.find((asset) => isKind(asset, kind));
}

function imageAssets(assets: Asset[]): Asset[] {
  return assets.filter((asset) => isKind(asset, 'image'));
}

function extractTaskId(payload: unknown): string | undefined {
  return (
    getString(payload, ['output', 'task_id']) ||
    getString(payload, ['id']) ||
    getString(payload, ['task_id']) ||
    getString(payload, ['data', 'id']) ||
    getString(payload, ['data', 'task_id'])
  );
}

function extractStatus(payload: unknown): TaskStatus {
  return (
    getString(payload, ['output', 'task_status']) ||
    getString(payload, ['status']) ||
    getString(payload, ['data', 'status']) ||
    getString(payload, ['task_status'])
  );
}

function extractVideoUrl(payload: unknown): string | undefined {
  return (
    getString(payload, ['output', 'video_url']) ||
    getString(payload, ['content', 'video_url']) ||
    getString(payload, ['data', 'video_url']) ||
    getString(payload, ['data', 'content', 'video_url']) ||
    getString(payload, ['result', 'video_url']) ||
    getString(payload, ['video_url']) ||
    getString(payload, ['output', 'url'])
  );
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message =
      getString(data, ['message']) ||
      getString(data, ['error', 'message']) ||
      getString(data, ['code']) ||
      response.statusText;
    const error = new UpstreamError(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

function alibabaEndpoint(): string {
  return 'https://dashscope.aliyuncs.com/api/v1';
}

function maybeNumber(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function buildHappyHorseRequest({ prompt, assets, parameters }: {
  prompt: string;
  assets: Asset[];
  parameters: GenerationParameters;
}): HappyHorsePayload {
  const video = pickFirstAsset(assets, 'video');
  if (!video) throw new Error('HappyHorse 需要 1 个视频素材');

  const seed = maybeNumber(parameters.seed);
  const duration = maybeNumber(parameters.duration);
  const media: HappyHorsePayload['input']['media'] = [
    { type: 'video', url: ensureUrl(video) },
    ...imageAssets(assets).slice(0, 5).map((asset) => ({
      type: 'reference_image' as const,
      url: ensureUrl(asset)
    }))
  ];

  return {
    model: 'happyhorse-1.0-video-edit',
    input: { prompt, media },
    parameters: {
      resolution: parameters.resolution || '720P',
      watermark: Boolean(parameters.watermark),
      ...(duration !== undefined ? { duration } : {}),
      ...(seed !== undefined ? { seed } : {})
    }
  };
}

function buildSeedanceRequest({ prompt, assets, parameters, model }: {
  prompt: string;
  assets: Asset[];
  parameters: GenerationParameters;
  model?: string;
}): SeedancePayload {
  const content: SeedanceContent[] = [{ type: 'text', text: prompt }];

  for (const asset of assets) {
    const url = ensureUrl(asset);
    if (isKind(asset, 'video')) {
      content.push({ type: 'video_url', video_url: { url } });
    } else if (isKind(asset, 'image')) {
      content.push({ type: 'image_url', image_url: { url } });
    } else if (isKind(asset, 'audio')) {
      content.push({ type: 'audio_url', audio_url: { url } });
    }
  }

  const duration = maybeNumber(parameters.duration);
  const seed = maybeNumber(parameters.seed);

  return {
    model: model || process.env.SEEDANCE_MODEL || 'seedance-2.0',
    content,
    ...(parameters.resolution ? { resolution: parameters.resolution } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(parameters.ratio ? { ratio: parameters.ratio } : {}),
    ...(seed !== undefined ? { seed } : {})
  };
}

async function createHappyHorseTask({ apiKey, payload }: {
  apiKey: string;
  payload: HappyHorsePayload;
}): Promise<unknown> {
  const base = alibabaEndpoint();
  const response = await fetch(`${base}/services/aigc/video-generation/video-synthesis`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable'
    },
    body: JSON.stringify(payload)
  });
  return readJsonResponse(response);
}

async function queryHappyHorseTask({ apiKey, taskId }: {
  apiKey: string;
  taskId: string;
}): Promise<unknown> {
  const base = alibabaEndpoint();
  const response = await fetch(`${base}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  return readJsonResponse(response);
}

function seedanceUrl(pathTemplate: string, taskId?: string): string {
  const base = (process.env.SEEDANCE_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  const cleanPath = pathTemplate.startsWith('/') ? pathTemplate : `/${pathTemplate}`;
  return `${base}${cleanPath.replace('{task_id}', encodeURIComponent(taskId || ''))}`;
}

async function createSeedanceTask({ apiKey, payload }: {
  apiKey: string;
  payload: SeedancePayload;
}): Promise<unknown> {
  const response = await fetch(seedanceUrl(process.env.SEEDANCE_CREATE_PATH || '/contents/generations/tasks'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  return readJsonResponse(response);
}

async function querySeedanceTask({ apiKey, taskId }: {
  apiKey: string;
  taskId: string;
}): Promise<unknown> {
  const response = await fetch(seedanceUrl(process.env.SEEDANCE_QUERY_PATH || '/contents/generations/tasks/{task_id}', taskId), {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  return readJsonResponse(response);
}

function sendError(res: ExpressResponse, error: unknown): void {
  const upstreamError = error instanceof UpstreamError ? error : undefined;
  const message = error instanceof Error ? error.message : '未知错误';
  res.status(upstreamError?.status || 400).json({
    error: message,
    details: upstreamError?.payload
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/upload', upload.array('files', 12), (req, res) => {
  const base = publicBaseUrl(req);
  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  const files = uploadedFiles.map((file) => ({
    id: crypto.randomUUID(),
    name: sanitizeOriginalName(file.originalname),
    type: file.mimetype,
    size: file.size,
    kind: file.mimetype.split('/')[0],
    url: `${base}/uploads/${encodeURIComponent(file.filename)}`
  }));

  res.json({
    files,
    publicBaseUrl: base,
    localOnly: /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(base)
  });
});

app.post('/api/generate', async (req, res) => {
  try {
    const { provider, apiKey: requestApiKey, prompt, assets = [], parameters = {}, model } = req.body as GenerateBody;
    if (!prompt?.trim()) throw new Error('请填写提示词');
    if (!assets.length) throw new Error('请至少添加一个视频、音频或图片素材');

    if (provider === 'happyhorse') {
      const apiKey = authKey(requestApiKey, 'ALIBABA_DASHSCOPE_API_KEY');
      if (!apiKey) throw new Error('缺少 ALIBABA_DASHSCOPE_API_KEY');
      const payload = buildHappyHorseRequest({ prompt, assets, parameters });
      const data = await createHappyHorseTask({ apiKey, payload });
      res.json({
        provider,
        taskId: extractTaskId(data),
        status: extractStatus(data),
        requestPayload: payload,
        response: data
      });
      return;
    }

    if (provider === 'seedance') {
      const apiKey = authKey(requestApiKey, 'VOLCENGINE_ARK_API_KEY');
      if (!apiKey) throw new Error('缺少 VOLCENGINE_ARK_API_KEY');
      const payload = buildSeedanceRequest({ prompt, assets, parameters, model });
      const data = await createSeedanceTask({ apiKey, payload });
      res.json({
        provider,
        taskId: extractTaskId(data),
        status: extractStatus(data),
        requestPayload: payload,
        response: data
      });
      return;
    }

    throw new Error('未知模型供应商');
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/tasks/:provider/:taskId', async (req, res) => {
  try {
    const provider = req.params.provider as Provider;
    const { taskId } = req.params;
    const { apiKey: requestApiKey } = req.body as TaskBody;
    let data: unknown;

    if (provider === 'happyhorse') {
      const apiKey = authKey(requestApiKey, 'ALIBABA_DASHSCOPE_API_KEY');
      if (!apiKey) throw new Error('缺少 ALIBABA_DASHSCOPE_API_KEY');
      data = await queryHappyHorseTask({ apiKey, taskId });
    } else if (provider === 'seedance') {
      const apiKey = authKey(requestApiKey, 'VOLCENGINE_ARK_API_KEY');
      if (!apiKey) throw new Error('缺少 VOLCENGINE_ARK_API_KEY');
      data = await querySeedanceTask({ apiKey, taskId });
    } else {
      throw new Error('未知模型供应商');
    }

    const status = extractStatus(data);
    res.json({
      provider,
      taskId,
      status,
      done: Boolean((status && okStatuses.has(status)) || extractVideoUrl(data)),
      running: Boolean(status && runningStatuses.has(status)),
      videoUrl: extractVideoUrl(data),
      response: data
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.listen(port, () => {
  console.log(`Seed/Horse editor running at http://localhost:${port}`);
});
