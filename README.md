# AI-Native Video Creation & Editing Platform

An AI-native video creation and editing system where users describe edits in natural language (e.g. *"Make it cinematic, remove awkward silences, add word-pop subtitles and upbeat music"*), and the system generates a validated JSON **Edit Plan**, resolves it deterministically into output-time **Timelines**, and compiles pure argument arrays for **FFmpeg** rendering with real-time SSE progress reporting.

---

## 🏗 System Architecture & Design Principles

```
React Client (Vite + Zustand)
       │ HTTPS / JSON        │ Direct S3 Multipart PUT
       ▼                     ▼
  Express API ──────────► AWS S3
       │                     ▲
       ├─► MongoDB 7         │ (raw, proxies, subs, previews, renders)
       │   (Mongoose 8)      │
       │                     │
       └─► Redis / BullMQ ───┴──► Workers (Node.js + child_process)
             ├─ analysis ───────── ffprobe, proxy, WAV, Whisper, silences, beats
             ├─ preview ────────── FFmpeg pure compiler (480p proxy)
             └─ render ─────────── FFmpeg pure compiler (1080p / 4K final)
                   │
                   ├─► Signed HMAC callback ──► Express API
                   └─► Redis job:{id} ────────► Express SSE ──► React Client
```

### Core Principles
1. **Deterministic Rendering vs Structured Data**: The LLM outputs data only (EditPlan JSON), never shell commands. Only deterministic server-side code compiles plans into FFmpeg argument arrays using `child_process.spawn('ffmpeg', argsArray)`.
2. **Immutability & Reversible Version Trees**: Raw uploaded video is immutable. Every accepted edit creates a new snapshot in `timelineVersions`. Undo and redo navigate the version tree without destructive mutations.
3. **Dual-Mode Rendering**: Previews use a fast 480p proxy (`preview_480p`); final exports use the original asset (`final_1080p` or `final_4k`). Both share the identical 5-pass pure compiler.
4. **Timebase Separation**:
   - `source` time: cuts, subtitles, speed changes, scene transitions.
   - `output` time: intro, outro, music mix, master overlays.
   - Mapped deterministically using `srcToOut` and `outToSrc`.

---

## 📁 Repository Structure

```
.
├── backend/                  # Node.js/Express API, Mongoose Models, Workers & Services
│   ├── src/
│   │   ├── config/           # Environment, MongoDB, Redis, S3 config
│   │   ├── controllers/      # Uploads, Projects, Prompts, Plans, Renders, Jobs, WorkerEvents
│   │   ├── middleware/       # Auth, Tenant isolation, RequestId, Worker HMAC verification
│   │   ├── models/           # Mongoose 8 models (User, Project, Asset, Timeline, EditPlan, etc.)
│   │   ├── routes/           # API routes (/api/uploads, /api/projects, /api/jobs, /api/internal)
│   │   ├── services/
│   │   │   ├── compiler/     # 5-pass pure FFmpeg argument builder
│   │   │   ├── events/       # Server-Sent Events (SSE) manager
│   │   │   ├── planner/      # AI Context Builder, Gemini/OpenAI adapters, Zod validation
│   │   │   ├── queue/        # BullMQ queues & Redis pub/sub
│   │   │   ├── resolver/     # Deterministic EditPlan -> Timeline resolver
│   │   │   └── storage/      # S3 multipart presigned URLs & storage keys
│   │   ├── workers/          # BullMQ queue consumers (analysisWorker, renderWorker)
│   │   ├── app.ts            # Express app configuration
│   │   └── server.ts         # Server bootstrap and graceful shutdown
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                 # React 18 + TypeScript + Vite + TailwindCSS
│   ├── src/
│   │   ├── api/              # Typed API client & SSE EventSource listeners
│   │   ├── components/
│   │   │   ├── dashboard/    # Project list & S3 chunked multipart upload wizard
│   │   │   └── editor/       # Header, VideoPlayer (Canvas 2D), Timeline, Chat, Inspector
│   │   ├── stores/           # Zustand + Immer editor state store
│   │   ├── App.tsx           # Main workspace view switcher
│   │   ├── index.css
│   │   └── main.tsx
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.ts
│
├── shared/                   # Shared TypeScript contracts, Zod schemas, and utilities
│   ├── src/
│   │   ├── constants/        # Resolution dimensions, color presets, audio defaults
│   │   ├── schemas/          # Zod discriminated unions for EditPlan & RFC 6902 patches
│   │   ├── types/            # EditPlan, Timeline, Analysis, Jobs, API request/response types
│   │   ├── utils/            # Time mapping algorithms (srcToOut, outToSrc, frame snapping)
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
│
├── package.json              # Monorepo NPM Workspaces configuration
└── tsconfig.base.json
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v20+ (tested on v22.18.0)
- **MongoDB**: 7.0+ (replica set enabled for multi-document version transactions)
- **Redis**: 7.0+ (for BullMQ queues and SSE progress pub/sub)
- **FFmpeg**: v6.0+ (for worker media analysis and rendering)

### 2. Environment Setup
Copy the example environment file in `backend`:
```bash
cp backend/.env.example backend/.env
```
Fill in your API keys (`GEMINI_API_KEY` or `OPENAI_API_KEY`), S3/MinIO bucket details, and secret keys.

### 3. Installation
Install all dependencies across the monorepo workspaces:
```bash
npm install
```

### 4. Running the Development Environment

Start the Backend API:
```bash
npm run dev:backend
```

Start the Background Workers:
```bash
# Analysis worker (ffprobe, audio extraction, transcription, beat/silence detection)
npm run dev:worker:analysis

# Render worker (deterministic FFmpeg preview and final export rendering)
npm run dev:worker:render
```

Start the React Frontend:
```bash
npm run dev:frontend
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

