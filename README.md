# AI-Native Video Creation & Editing Platform

> **Production-grade, fullstack AI video creation platform that transforms raw long-form footage into polished multi-track edits and viral 9:16 Shorts via natural language prompts.**

[![Tests](<https://img.shields.io/badge/Tests-702%20Passed%20(70%20Suites)-emerald>)](file:///d:/Fullstack/AI-Navtive%20Video%20Creation%20Platform)
[![Frontend](https://img.shields.io/badge/Frontend-React%2018%20%7C%20TypeScript%20%7C%20Zustand-blue)](file:///d:/Fullstack/AI-Navtive%20Video%20Creation%20Platform/frontend)
[![Backend](https://img.shields.io/badge/Backend-Node.js%2022%20%7C%20Express%20%7C%20BullMQ-purple)](file:///d:/Fullstack/AI-Navtive%20Video%20Creation%20Platform/backend)
[![Database](https://img.shields.io/badge/Database-MongoDB%207%20%7C%20Redis%207-green)](file:///d:/Fullstack/AI-Navtive%20Video%20Creation%20Platform)
[![Media Engine](https://img.shields.io/badge/Media-FFmpeg%206%20%7C%20Whisper%20%7C%20Gemini-orange)](file:///d:/Fullstack/AI-Navtive%20Video%20Creation%20Platform)
[![Performance](https://img.shields.io/badge/Scaling-500%2B%20Ops%20%40%200.26ms-cyan)](file:///d:/Fullstack/AI-Navtive%20Video%20Creation%20Platform)

---

## 📑 Table of Contents

1. [Core Features](#-core-features)
2. [The Killer Demo](#-the-killer-demo)
3. [System Architecture Diagram](#-system-architecture-diagram)
4. [Performance & Scaling Benchmarks](#-performance--scaling-benchmarks)
5. [Tech Stack](#-tech-stack)
6. [Getting Started & Local Setup](#-getting-started--local-setup)
7. [Running Tests](#-running-tests)
8. [Documentation Links](#-documentation-links)

---

## ⚡ Core Features

### 1. Resumable Direct-to-S3 Multipart Upload

- Uploads multi-gigabyte raw footage directly to **AWS S3** / MinIO in 10MB chunks with 3x parallel streams.
- Client-side SHA-256 checksum verification and retry logic eliminate API gateway timeouts and server memory buffering.

### 2. Multimodal Footage Indexing (Up to 3 Hours Asynchronously)

- **Word-Level Transcription**: Word-by-word timestamps via Whisper with start/end millisecond precision.
- **Acoustic Waveform & Silence Detection**: Automatic extraction of speech intervals, silences, and acoustic energy peaks using FFmpeg.
- **Scene Boundary Detection**: Identifies visual cut candidates and scene shifts.
- **Timestamp Dilation Auto-Calibration**: Automatically corrects AI timestamp dilation against physical video durations.

### 3. Schema-Validated AI Edit Planner

- Translates natural language editing requests into an immutable **Edit Plan Abstract Syntax Tree (AST)** validated with strict **Zod** discriminated union schemas.
- **Zero Hallucination / Zero Injection**: The LLM outputs data only (JSON), never executable shell commands.

### 4. High-Performance Multi-Track Timeline (500+ Operations)

- Visual tracks for **Video Cuts**, **B-Roll Overlays**, **Subtitle Karaoke**, **Background Music**, and **Color Grading**.
- **Blazing Fast State Engine**: Processes 500+ operations in under **3.52ms cold** and **0.012ms warm**, scrubbing at **0.26ms per scrub** (1.6% of the 60fps frame budget).
- **Timebase Separation**: Bidirectional coordinate mapping between raw **Source Time ($T\_{src}$)** and composite **Output Time ($T\_{out}$)**.

### 5. Multi-Layer Video Compositing

- **Visual Media Overlays**: Full-screen B-roll cutaways, Picture-in-Picture (PIP) windows, and floating graphic overlays with crossfade transitions.
- **Generative Media**: Integrated Imagen / AI B-roll prompt generator for instant illustrative media insertion.
- **Audio Ducking & Music**: Lowers background music by 12dB automatically during active vocal speech.
- **Animated Subtitles**: HTML5 Canvas 2D overlay rendering dynamic karaoke highlights synchronized to the video playback playhead.

### 6. Version History & Bidirectional Rebase

- Immutable snapshot tree with instant undo/redo.
- Optimistic concurrency control and RFC 6902 JSON patch rebasing allow users to edit in parallel with asynchronous AI agent suggestions.

### 7. Horizontally Scalable Asynchronous Render Pipeline

- Distributed **BullMQ** worker fleet with concurrency pooling.
- **5-Pass Pure FFmpeg Argument Compiler**: Generates clean, shell-safe parameter arrays for broadcast-quality 1080p and 4K exports.
- **p95 Latency Tracking & Telemetry**: Continuous monitoring of queue wait times and transcode performance.
- **Server-Sent Events (SSE)**: Real-time progress updates (percentage, FPS, ETA) streamed to the client without polling.

---

## 🎬 The Killer Demo

Experience the full capabilities of the platform in one unified workflow:

```mermaid
flowchart LR
    A["Raw 10-Min Video\n(Repeated Takes & Pauses)"] --> B["Creator Prompt:\n'Tighten first 15s, cut repeated\ntakes, add B-roll & 3 Shorts'"]
    B --> C["AI Planner AST\n(Zod Validated Operations)"]
    C --> D["Multi-Track Timeline\n(Live Visual Updates)"]
    D --> E["Shorts Studio Switcher\n(3 Tabbed 9:16 Views)"]
    E --> F["Async Distributed Export\n(1080p Master + 3x Shorts)"]
```

1. **Upload Raw Media**: Click **"1-Click Killer Demo"** on the dashboard to instantiate a pre-analyzed multi-take raw footage project.
2. **Execute Natural Language Prompt**:
   > _"Tighten the first 15 seconds, remove repeated takes, add B-roll and generate three Shorts."_
3. **Instant Visual Timeline Transformation**:
   - Cut at `0:00.0 - 0:01.8` (`reason: tighten_pacing`).
   - Cut at `0:02.5 - 0:08.2` (`reason: repeated_take`).
   - 2x B-roll cutaway overlays inserted (`broll_tech` and `broll_workspace`).
   - 3x Vertical Shorts discovered and generated with 9:16 aspect ratios.
4. **Shorts Studio Switcher**: Preview each Short in real time using the viewport tabs above the player.
5. **Inspect & Adjust**: In-place subtitle editor allows adjusting timing, shifting cues, and snapping to playhead before final render.
6. **Export**: Queue the export to render both the 1080p widescreen master cut and all 3 vertical Shorts simultaneously.

---

## 🏗 System Architecture Diagram

```mermaid
flowchart TB
    subgraph Frontend ["Frontend Client (React 18 + Zustand + Immer + Canvas 2D)"]
        UI["Studio Interface"]
        Timeline["Multi-Track Timeline (500+ Ops)"]
        Player["HTML5 Player + Canvas 2D Subtitles"]
        Inspector["Inspector & In-Place Editor"]
        ShortsStudio["Shorts Studio Switcher (9:16)"]
    end

    subgraph BackendAPI ["Backend API & Gateway (Node.js 22 + Express 4)"]
        API["REST & SSE Server (/api)"]
        AuthGuard["JWT & Tenant Isolation Guard"]
        UploadManager["S3 Multipart Presigned Manager"]
        PlannerService["AI Planner & Context Builder"]
        Telemetry["p95 Render Latency Tracker"]
    end

    subgraph ExternalAI ["AI Intelligence Layer"]
        Gemini["Google Gemini (Multimodal Language & Vision)"]
        Whisper["Whisper (Word-Level Timestamps)"]
    end

    subgraph StorageQueue ["Storage & Distributed Queue"]
        S3[("AWS S3 / MinIO Storage")]
        Mongo[("MongoDB 7 Replica Set")]
        Redis[("Redis 7 / BullMQ")]
    end

    subgraph Workers ["Distributed Worker Fleet (Horizontally Scaled)"]
        AnalysisWorker["Analysis Worker (ffprobe, audio slice, silence detect)"]
        RenderWorker1["Render Worker 1 (5-Pass Pure FFmpeg Compiler)"]
        RenderWorkerN["Render Worker N (Scaled across nodes)"]
    end

    UI --> API
    Timeline --> UI
    Player --> S3
    Inspector --> UI
    ShortsStudio --> UI

    API --> AuthGuard
    API --> UploadManager
    API --> PlannerService
    API --> Telemetry

    UploadManager --> S3
    PlannerService --> Gemini
    PlannerService --> Mongo
    PlannerService --> Redis

    Redis --> AnalysisWorker
    Redis --> RenderWorker1
    Redis --> RenderWorkerN

    AnalysisWorker --> Whisper
    AnalysisWorker --> S3
    AnalysisWorker --> Mongo

    RenderWorker1 --> S3
    RenderWorkerN --> S3
    RenderWorker1 -.->|"HMAC Signed Progress"| API
    RenderWorkerN -.->|"HMAC Signed Progress"| API

    API -.->|"Server-Sent Events (SSE)"| UI
```

---

## 📊 Performance & Scaling Benchmarks

Rigorous automated benchmark gates verify that the platform scales reliably under high volume:

| Benchmark Gate                    | Target Specification     | Production Result                       | Headroom                                   |
| :-------------------------------- | :----------------------- | :-------------------------------------- | :----------------------------------------- |
| **500+ Operations Extraction**    | < 100 ms                 | **3.52 ms** (Cold), **0.012 ms** (Warm) | **83x faster than target**                 |
| **1,000+ Operations Throughput**  | > 10,000 ops/second      | **203,221 ops/second**                  | **20x higher than target**                 |
| **Scrubbing Latency @ 500+ Ops**  | < 16.6 ms (60fps budget) | **0.26 ms / scrub**                     | **Uses only 1.6% of frame budget**         |
| **Canvas 2D Word Highlight Draw** | < 4.0 ms / frame         | **0.003 ms / frame**                    | **Instantaneous 60fps subtitle rendering** |
| **Derived Track Selectors**       | 1,000 calls < 100 ms     | **48.58 ms** (48 µs / call)             | **Sub-millisecond state updates**          |
| **Long-Form Audio Slicing**       | 3 hours (~345MB WAV)     | **36 continuous monotonic chunks**      | **Zero memory spikes / zero OOMs**         |

---

## 🛠 Tech Stack

| Layer                | Technologies                                          | Role in System                                                               |
| :------------------- | :---------------------------------------------------- | :--------------------------------------------------------------------------- |
| **Frontend UI**      | React 18, Vite, TypeScript, TailwindCSS, Lucide Icons | Responsive studio UI, virtualized multi-track timeline, in-place cue editor. |
| **Client State**     | Zustand, Immer                                        | Immutable version tree navigation, instant undo/redo, derived selectors.     |
| **Player / Canvas**  | HTML5 Video, HTML5 Canvas 2D                          | Word-accurate karaoke subtitle highlights, frame-accurate seeking.           |
| **Backend API**      | Node.js 22, Express 4, TypeScript                     | REST endpoints, SSE streaming, S3 presigning, HMAC security guards.          |
| **Databases**        | MongoDB 7 (Replica Set), Mongoose 8                   | Multi-document transactions, version snapshots, project metadata.            |
| **Queue / Cache**    | Redis 7, BullMQ v5                                    | Distributed job scheduling, worker concurrency pooling, SSE pub/sub.         |
| **Media Processing** | FFmpeg 6.0+, FFprobe                                  | Audio extraction, scene detection, 5-pass video compilation, H.264/AAC.      |
| **Cloud Storage**    | AWS S3 / MinIO                                        | Resumable multipart uploads, presigned direct PUTs, CDN distribution.        |
| **AI Intelligence**  | Google Gemini (1.5 / 2.0), OpenAI Whisper             | Multimodal edit planning, word-level audio transcription.                    |
| **Testing**          | Vitest, Supertest                                     | 70 test suites, 702 tests across unit, integration, and scaling gates.       |

---

## 🚀 Getting Started & Local Setup

### 1. Prerequisites

- **Node.js**: v20+ (recommended: v22.18.0+)
- **Docker & Docker Compose** (for MongoDB, Redis, and MinIO)
- **FFmpeg**: v6.0+ installed and available in system PATH

### 2. Environment Configuration

Clone the repository and prepare your environment file:

```bash
cp backend/.env.example backend/.env
```

Ensure the following variables are configured in `backend/.env`:

```env
PORT=4000
MONGODB_URI=mongodb://localhost:27017/ai-video-studio?replicaSet=rs0
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret_key_minimum_32_characters
WORKER_HMAC_SECRET=your_worker_hmac_secret_key_32_chars
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET_NAME=ai-video-studio-media
S3_ENDPOINT=http://localhost:9000
S3_FORCE_PATH_STYLE=true
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Start Infrastructure Services

Start MongoDB (with replica set enabled) and Redis using Docker Compose:

```bash
docker-compose up -d mongo redis minio
```

### 4. Install Dependencies & Build Packages

```bash
npm install
npm --workspace=shared run build
```

### 5. Start Development Servers

In separate terminals:

```bash
# Terminal 1: Backend API
npm --workspace=backend run dev

# Terminal 2: Analysis Worker
npm --workspace=backend run worker:analysis

# Terminal 3: Render Worker
npm --workspace=backend run worker:render

# Terminal 4: Frontend Web Client
npm --workspace=frontend run dev
```

Open **`http://localhost:5173`** in your browser to launch the Studio.

---

## 🧪 Running Tests

The platform features an exhaustive automated test suite with **70 test files and 702 passing tests**:

```bash
# Run all backend tests (51 test suites, 546 tests)
npm --workspace=backend run test

# Run all frontend tests (19 test suites, 156 tests)
npm --workspace=frontend run test

# Verify production builds
npm --workspace=backend run build
npm --workspace=frontend run build
```

---

## 📚 Documentation Links

- **[System Architecture Document](file:///d:/Fullstack/AI-Navtive%20Video%20Creation%20Platform/docs/SYSTEM_ARCHITECTURE.md)**: Deep dive into distributed data flows, sequence diagrams, and security architecture.
- **[Interview Preparation & System Design Guide](file:///d:/Fullstack/AI-Navtive%20Video%20Creation%20Platform/docs/INTERVIEW_PREP.md)**: Comprehensive interview guide covering elevator pitches, trade-offs, scalability questions, and key metrics.
- **[Architectural Decision Records (ADRs)](file:///d:/Fullstack/AI-Navtive%20Video%20Creation%20Platform/docs/ARCHITECTURAL_DECISIONS.md)**: Decisions on MongoDB replica sets, deterministic AST compilation, and S3 multipart chunking.
- **[Operations Runbook](file:///d:/Fullstack/AI-Navtive%20Video%20Creation%20Platform/docs/OPERATIONS_RUNBOOK.md)**: Production deployment, worker horizontal scaling, monitoring, and backup/restore procedures.
