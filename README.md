# Seed Horse Edit

本地 Web 工具，用于拖拽添加视频、音频、图片和提示词，发起阿里 HappyHorse 1.0 与字节 Seedance 2.0 的视频编辑/生成任务。

## 启动

```bash
npm install
cp .env.example .env
npm run dev
```

打开：

```text
http://localhost:5177
```

API key 可以填在页面里，也可以写入 `.env`：

```bash
ALIBABA_DASHSCOPE_API_KEY=
VOLCENGINE_ARK_API_KEY=
```

## 素材 URL

HappyHorse 官方接口要求视频和参考图是公网可访问 URL。页面拖拽上传的文件会放到本地 `/uploads`，如果你只在 `localhost` 运行，云端模型通常访问不到这些文件。

可选做法：

```bash
PUBLIC_BASE_URL=https://你的公网域名
```

也可以直接在页面的 URL 输入框中添加已经公开可访问的视频、图片或音频地址。

## 模型适配

HappyHorse 已按阿里云 Model Studio 国内北京区域配置：

- 模型：`happyhorse-1.0-video-edit`
- 创建任务：`/api/v1/services/aigc/video-generation/video-synthesis`
- 查询任务：`/api/v1/tasks/{task_id}`
- Base URL：`https://dashscope.aliyuncs.com/api/v1`

Seedance 使用火山方舟 Bearer 鉴权和可配置任务端点：

```bash
SEEDANCE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
SEEDANCE_CREATE_PATH=/contents/generations/tasks
SEEDANCE_QUERY_PATH=/contents/generations/tasks/{task_id}
SEEDANCE_MODEL=seedance-2.0
```

如果你的 Seedance 2.0 控制台给出了不同的模型 ID 或路径，直接改 `.env` 或页面里的模型字段。

## TypeScript

源码位于：

- `src/server/server.ts`
- `src/client/app.ts`

构建命令：

```bash
npm run build
```

构建后后端输出到 `dist/server.js`，前端脚本输出到 `public/app.js`。
