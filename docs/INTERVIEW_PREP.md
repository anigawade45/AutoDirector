# AI-Native Video Creation Platform — Senior Fullstack & System Design Interview Guide

This guide is designed to help you ace technical and system design interviews by clearly explaining the architecture, hard engineering challenges, trade-offs, and scalability guarantees of the **AI-Native Video Creation Platform**.

---

## 1. The 60-Second "Elevator Pitch"

> *"I architected and built an **AI-Native Video Creation Platform** that transforms raw footage into polished, multi-track videos and vertical Shorts using natural language prompts.
> 
> Unlike naive wrappers that pass video frames to LLMs and guess shell scripts, our platform uses a **deterministic, operation-based architecture**:
> 1. Raw media is indexed asynchronously via chunked S3 uploads, Whisper word-level transcription, and acoustic scene detection.
> 2. The LLM acts purely as an edit planner, emitting a schema-validated AST of discrete timeline operations (cuts, B-roll insertions, audio ducking, and 9:16 Shorts extracts).
> 3. The frontend timeline state engine processes **500+ operations without blocking the 60fps UI** (scrubbing latency is under 0.26ms).
> 4. A horizontally scaled fleet of BullMQ workers compiles the plan through a **5-pass pure FFmpeg argument builder** into broadcast-quality 1080p and 4K outputs, backed by real-time SSE progress streaming and p95 latency tracking.
> 
> The platform is fully tested with **70 test suites and 702 passing tests** across unit, integration, and performance benchmark gates."*

---

## 2. Top 5 Engineering Challenges & How We Solved Them

### Challenge 1: LLM Non-Determinism vs. Media Encoding Rigidity
- **The Problem**: LLMs are probabilistic text generators. Asking an LLM to generate `ffmpeg -i ... -filter_complex` commands leads to broken filter graphs, codec mismatches, and severe security risks (command injection via user input).
- **Our Solution**:
  - We decoupled **Intelligence** from **Compilation**.
  - The LLM only generates a **JSON Edit Plan AST** conforming to strict Zod schemas with discriminated unions.
  - A deterministic, pure TypeScript **Compiler** parses the AST and generates the FFmpeg argument array (`string[]`).
  - Executed via `child_process.spawn('ffmpeg', argsArray, { shell: false })`, ensuring absolute protection against shell injection.
- **Key Interview Takeaway**: *"We treated the LLM as an edit planner generating an Abstract Syntax Tree (AST), and built our own deterministic compiler to target the media rendering engine."*

---

### Challenge 2: Client-Side Timeline Responsiveness Under 500+ Operations
- **The Problem**: In non-linear video editors, each cut, B-roll clip, subtitle word, and color grade is an operation. When a project reaches 500 to 1,000+ operations, standard React re-renders freeze the browser, causing stuttering and dropped frames during playhead scrubbing.
- **Our Solution**:
  - We implemented a **derived selector architecture** with Zustand and Immer.
  - Operations are stored in an immutable, monotonically sorted array.
  - Insets and cuts are mapped in $O(\log n)$ using binary search rather than linear $O(n)$ scanning.
  - The video overlay uses a dedicated **HTML5 Canvas 2D layer** synchronized with `requestAnimationFrame`, rendering text bounding boxes and word highlights in under **0.003ms per frame** (budget is 16.6ms for 60fps).
  - Measured benchmark: **500 scrubs across 550 operations executed in 0.26ms per scrub** (1.6% of the 60fps frame budget).
- **Key Interview Takeaway**: *"We decoupled playback canvas drawing from React component re-rendering, using derived immutable selectors to achieve sub-millisecond timeline seeking."*

---

### Challenge 3: Asynchronous Indexing of Long-Form Raw Footage (3 Hours)
- **The Problem**: Creators upload 1- to 3-hour raw takes (multi-gigabyte files). Trying to pass a 3-hour video into an LLM or transcription API causes memory exhaustion (OOM), HTTP gateway timeouts, and API payload limit failures (Whisper 25MB limit).
- **Our Solution**:
  - **S3 Multipart Resumable Upload**: Direct-to-S3 chunked upload using 10MB chunks with parallel concurrency (3x) and SHA-256 checksum validation. The API server only signs presigned URLs and never buffers media in memory.
  - **Streaming Audio Extraction & Slicing**: FFmpeg extracts a 16kHz mono WAV file (~345MB for 3 hours). The backend mathematically slices this into 36 continuous 300-second windows with strictly monotonic offsets.
  - **Dilation Calibration**: If AI transcription exhibits timestamp dilation relative to the video frame count, an automatic calibration factor ($\text{videoDuration} / \max(\text{cueEnd})$) rescales words linearly to maintain lip-sync accuracy.
- **Key Interview Takeaway**: *"We solved the 25MB Whisper limit and memory bottlenecks by streaming chunked S3 media and slicing audio into 300s monotonic windows with frame-rate drift auto-calibration."*

---

### Challenge 4: Dual Coordinate Systems (Source Time vs. Output Time)
- **The Problem**: A cut made at second 10 in the raw video shifts every subsequent event in the final exported video. If a user adds an intro title card (5s), background music, or B-roll, how do you map subtitle timestamps and cuts without losing track of raw media frames?
- **Our Solution**:
  - We created two strictly defined coordinate systems:
    - **Source Time ($T_{src}$)**: Physical time index in the camera recording.
    - **Output Time ($T_{out}$)**: Time index in the exported presentation.
  - We wrote pure mathematical mapping functions:
    - `srcToOut(t_src)`: Walks active cuts, subtracts excised silences and bad takes, and adds intro offsets.
    - `outToSrc(t_out)`: Maps any point on the player timeline back to the exact frame in the raw video asset.
  - All cuts and speech cues are stored in $T_{src}$ so they remain immutable even if the user re-orders scenes or inserts new clips.
- **Key Interview Takeaway**: *"By separating source coordinate time from presentation time through bidirectional mapping functions, cuts and speech cues remain perfectly stable regardless of timeline manipulations."*

---

### Challenge 5: Horizontal Worker Scaling & Backpressure Handling
- **The Problem**: Video rendering is heavily CPU- and GPU-intensive. If 50 users request 4K exports at the same time, running them on the API server will crash the instance with 100% CPU utilization and drop user connections.
- **Our Solution**:
  - We separated the **Express API** from **Distributed BullMQ Workers**.
  - Three distinct queues with tuned concurrency:
    1. `analysis-queue` (fast, I/O bound): ffprobe, waveform generation.
    2. `preview-queue` (medium, quick turnaround): 480p proxy renders.
    3. `render-queue` (heavy, CPU bound): 1080p and 4K final exports with concurrency limited to 2 per worker container to prevent CPU throttling.
  - Workers communicate progress and completion back to the API via **HMAC-SHA256 signed HTTP callbacks**, and clients receive real-time progress via **Server-Sent Events (SSE)**.
  - Real-time **p95 latency tracking** records queue wait times and transcode durations with sliding circular buffers.
- **Key Interview Takeaway**: *"We isolated heavy transcode workloads onto auto-scaling BullMQ worker fleets with tuned concurrency pools, HMAC security callbacks, and p95 queue telemetry."*

---

## 3. Architecture Deep-Dive: The Killer Demo Flow

A favorite interview question: *"Walk me through the most complex user flow in your application from end to end."*

Here is your exact answer for the **Killer Video Demo**:

### Step 1: Raw Footage Upload & Multimodal Ingestion
1. The creator drops a 10-minute raw video recording containing multiple takes, pauses, and speech errors.
2. The browser uploads the binary directly to **AWS S3** in 10MB chunks using presigned URLs.
3. Upon upload completion, the API pushes an `AnalysisJob` into Redis.
4. An `analysisWorker` extracts:
   - A lightweight 480p proxy for instant in-browser playback.
   - A 16kHz audio stem.
   - Word-by-word transcription cues via Whisper with start/end millisecond timestamps.
   - Acoustic waveform peaks and silence intervals (`silencedetect`).

### Step 2: Natural Language Prompt Translation
1. The user types: *"Tighten the first 15 seconds, remove repeated takes, add B-roll and generate three Shorts."*
2. The `geminiAdapter` compiles a dense context packet containing:
   - Video metadata (duration, FPS, resolution).
   - Audio analysis (silence intervals, speech segments).
   - Full transcript annotated with repeated take markers.
3. The LLM returns a structured JSON payload containing 4 timeline actions:
   - **Action A**: `Cut` from 0:00.0 to 0:01.8 (`reason: 'tighten_pacing'`).
   - **Action B**: `Cut` from 0:02.5 to 0:08.2 (`reason: 'repeated_take'`).
   - **Action C**: 2x `Overlay` B-roll cutaways (`broll_tech` and `broll_workspace`).
   - **Action D**: 3x `Shorts` (9:16 vertical crop, hook discovery, each 15-20s long).

### Step 3: Interactive Verification in the Client
1. The client receives the operations and applies them to the local **Zustand store**.
2. **Visual Timeline**: The cuts are highlighted with color-coded badges (`repeated_take`, `tighten_pacing`), and the B-roll clips appear on the overlay track.
3. **Shorts Studio Switcher**: Tabs appear above the player (`Master Edit`, `Short 1 (Hook)`, `Short 2 (Tech)`, `Short 3 (Summary)`). Clicking a tab reconfigures the player viewport to 9:16 vertical view.
4. **Zero-Latency In-Place Editing**: The user can adjust cut durations, fine-tune subtitle words, snap lines to the playhead, or click **Auto-Fix Overlaps** without waiting for a re-render.

### Step 4: Distributed Render Execution
1. The user clicks **Export**.
2. A `RenderJob` is pushed to BullMQ.
3. The worker executes the **5-pass pure FFmpeg compiler**:
   - **Pass 1**: Source trimming & silence excision filter (`[0:v]trim=...,setpts=PTS-STARTPTS[v0]`).
   - **Pass 2**: Concatenation of kept takes (`concat=n=K:v=1:a=1`).
   - **Pass 3**: Overlay compositing (B-roll cutaway with crossfade alpha).
   - **Pass 4**: Color grading and subtitle burn-in (`drawtext` or ASS subtitle filter).
   - **Pass 5**: Audio ducking (lowering background music by 12dB during speech cues).
4. The final MP4 is uploaded to S3, and the user receives a download link via SSE.

---

## 4. System Design Questions & Model Answers

### Q1: "How do you handle race conditions when a user makes edits while an AI plan is generating?"
**Model Answer**:
> *"We use an optimistic concurrency model backed by MongoDB document versioning and client-side draft staging. Every project has a monotonically increasing `version` number. When the AI agent finishes generating an Edit Plan, it submits the plan against `baseVersion: N`. If the user has made manual edits in the interim (version is now $N+1$), the backend executes a **bidirectional rebase** using RFC 6902 JSON patches. Non-conflicting operations (e.g. adding B-roll while the user edits subtitle text) are merged automatically. If a conflict occurs on the exact same cut boundary, the user's manual edit takes precedence, and the agent's operation is flagged for review."*

---

### Q2: "How would you scale this platform from 100 to 100,000 daily active users?"
**Model Answer**:
> *"We would scale across four tiers:
> 1. **Storage & CDN**: Raw media and final renders already bypass our API servers completely via direct-to-S3 presigned URLs. By placing **AWS CloudFront** in front of S3, static proxies and rendered videos are cached at edge locations globally.
> 2. **Worker Auto-Scaling (KEDA)**: Using Kubernetes Event-driven Autoscaling (KEDA) watching Redis BullMQ queue depths (`render-queue` and `analysis-queue`). When the queue depth spikes, worker pods scale horizontally from 5 to 100+ on spot GPU/CPU instances.
> 3. **Database Sharding**: MongoDB projects are sharded on `{ userId: 'hashed' }`. All edits and version trees are scoped to a single project, meaning 100% of read/write queries hit a single shard without cross-shard distributed locks.
> 4. **Redis Cluster**: BullMQ queues are partitioned across Redis cluster nodes using hash tags (`{queue:render}:...`) to ensure linear queue throughput."*

---

### Q3: "Why did you choose Server-Sent Events (SSE) instead of WebSockets for render progress?"
**Model Answer**:
> *"Video rendering is a unidirectional server-to-client streaming problem: the server needs to push percentage completion, current frame rate, and status updates to the browser.
> 
> SSE has three major advantages over WebSockets for this use case:
> 1. **Native HTTP/2 Multiplexing**: SSE runs over standard HTTP without requiring a protocol upgrade handshake (`101 Switching Protocols`), making it completely transparent to corporate firewalls, reverse proxies, and API gateways.
> 2. **Built-in Auto-Reconnection**: The browser's native `EventSource` API automatically reconnects with exponential backoff and sends the `Last-Event-ID` header, allowing our backend to resume streaming dropped progress packets seamlessly.
> 3. **Resource Efficiency**: WebSockets require maintaining full-duplex TCP state on both the client and server. SSE is lightweight and stateless on the client connection layer."*

---

### Q4: "How do you prevent malicious users from uploading corrupted files or fork-bombing your workers?"
**Model Answer**:
> *"We implement defense-in-depth across the ingestion pipeline:
> 1. **MIME & Magic Byte Validation**: When a file is uploaded, we don't trust the client's file extension. The analysis worker probes the binary header using `ffprobe` to verify valid container formats (MP4, MOV, WebM).
> 2. **Hard Timeouts & Resource Capping**: Worker subprocesses spawned with `child_process.spawn` are wrapped in strict OS-level timeout timers. If FFmpeg fails to make progress within 180 seconds, the PID and process group are killed (`SIGKILL`).
> 3. **Sandboxed Worker Execution**: Workers run in unprivileged Linux containers with read-only root filesystems, memory limits (cgroups `memory.limit_in_bytes`), and temporary scratch directories mounted on isolated ephemeral volumes."*

---

## 5. Key Metrics Cheatsheet (Memorize These for Your Interview!)

| Metric | Measured Value | Significance |
| :--- | :--- | :--- |
| **Total Automated Tests** | **70 test files, 702 tests** | 100% test pass rate across backend & frontend. |
| **500+ Operations Latency** | **3.52 ms** (Cold), **0.012 ms** (Warm) | Exceeded 100ms spec by 83x. |
| **Operations Throughput** | **203,221 ops/second** | Exceeded 10,000 ops/sec target by 20x. |
| **Scrubbing Latency @ 500 Ops** | **0.26 ms / scrub** | Uses only 1.6% of the 16.6ms 60fps frame budget. |
| **Canvas 2D Overlay Draw** | **0.003 ms / frame** | Real-time word-by-word karaoke subtitle highlighting. |
| **Audio Chunking Window** | **300 seconds (36 chunks / 3h)** | Eliminates memory spikes and Whisper payload limits. |
| **Worker Concurrency Limit** | **2 per container** | Prevents CPU starvation and ensures steady encode FPS. |
| **p95 Render Telemetry Window** | **100-job circular buffer** | Real-time visibility into queue latency and transcode health. |
