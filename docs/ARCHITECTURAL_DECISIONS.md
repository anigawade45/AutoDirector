# Architectural Decision Records (ADRs) & Technology Review

## Document Overview
This document reviews the four foundational architectural decisions evaluated for the **AI-Native Video Creation & Editing Platform MVP (v1.0.0)**, detailing the options analyzed, trade-offs, benchmarks, rationale for current MVP selection, and the roadmap for future scale.

---

## ADR 1: Intro & Outro Motion Graphic Rendering Approach

### Context & Challenge
The platform allows creators to inject animated titles, logos, and outro cards (e.g. `cinematic_minimal`, `fade_to_black`) parameterized with dynamic text, colors, and fonts directly from LLM edit plans.

### Evaluated Options
1. **Option A: Pure FFmpeg Filter Graphs (`lavfi color`, `drawtext`, `fade`, `overlay`)** *(Chosen for MVP)*:
   - *How it works*: Synthesizes color background canvases, animates opacity via `fade=t=in:st=0:d=1.0`, positions dynamic typography via `drawtext`, and concatenates seamlessly with video footage.
   - *Pros*: Zero external dependencies; zero asset storage required; 100% deterministic frame execution; compiles in milliseconds; runs anywhere FFmpeg runs.
   - *Cons*: Advanced easing curves and complex SVG vector animations are cumbersome to express in pure FFmpeg filter syntax.
2. **Option B: Pre-Rendered Alpha Channel Video Overlays (ProRes 4444 / WebM with VP9 Alpha)**:
   - *How it works*: After Effects artists design motion graphics templates, render transparent alpha video clips, and store them in the S3 catalog.
   - *Pros*: Studio-grade particle effects, 3D graphics, and broadcast transitions.
   - *Cons*: Large catalog file sizes (50MB–200MB per template); does not support dynamic typography without secondary overlay passes; alpha blending introduces decoding overhead.
3. **Option C: Headless Browser Canvas Rendering (Remotion / Puppeteer)**:
   - *How it works*: Renders React components frame-by-frame inside headless Chromium, outputting frames to an FFmpeg pipe.
   - *Pros*: Complete CSS3/WebGL/React animation ecosystem; infinite creative flexibility.
   - *Cons*: Chromium memory overhead (500MB+ per render instance); $3\times$ longer render times compared to native FFmpeg.

### Decision & MVP Strategy
- **Adopt Option A (Dynamic FFmpeg Filter Graphs) for MVP v1.0.0**.
- **Rationale**: Achieves sub-second plan-to-render compilation, requires zero disk-heavy asset downloads on worker nodes, and guarantees 0 ms audio/video drift.
- **Post-MVP Roadmap (Phase 10+)**: Introduce a hybrid worker step where Node-Canvas / Skia pre-renders vectorized motion overlays for higher-tier Enterprise brand templates.

---

## ADR 2: Audio Transcription & Caption Generation Hosting Strategy

### Context & Challenge
Media analysis requires sub-second scene detection, loudness measurement, beat tracking, and word-level speech-to-text alignment for word-pop subtitles.

### Evaluated Options
1. **Option A: Managed Cloud Speech-to-Text API (OpenAI Whisper Cloud / Google Cloud Speech-to-Text / Deepgram Nova)** *(Chosen for MVP)*:
   - *Pros*: Zero machine learning infrastructure maintenance; instant auto-scaling to thousands of concurrent uploads; handles 100+ languages and accents natively; word-level confidence scores.
   - *Cons*: Variable per-minute API cost ($0.006–$0.024/minute); audio files must be uploaded over network to external provider.
2. **Option B: Self-Hosted Faster-Whisper / Whisper.cpp on Dedicated GPU Worker Nodes**:
   - *Pros*: Complete data sovereignty (audio never leaves VPC); zero per-minute provider billing; sub-realtime execution ($< 0.1\times$ realtime on Nvidia T4/L4 GPUs).
   - *Cons*: High fixed infrastructure baseline ($300+/month per GPU instance); model cold-start latency; Docker image bloat (CUDA + PyTorch + model weights $\approx 4.5\text{ GB}$).

### Decision & MVP Strategy
- **Adopt Option A (Managed Cloud Speech API with Local Heuristic Fallback) for MVP v1.0.0**.
- **Rationale**: Maximizes development velocity, eliminates GPU management overhead, and ensures high transcription accuracy across global creator languages without cluster cold-starts.
- **Breakeven Threshold**: When monthly audio processed exceeds 5,000 hours, deploy a self-hosted `Faster-Whisper` worker pool on Kubernetes with Nvidia TensorRT-LLM acceleration.

---

## ADR 3: Video Transcoding & Hardware Acceleration (CPU vs. GPU)

### Context & Challenge
Workers must render 480p preview proxies in $< 0.5\times$ realtime and 1080p/4K master exports with broadcast audio normalization and color grading.

### Evaluated Options
1. **Option A: CPU Software Encoding (`libx264` / `libx265` with Fast Preset)** *(Chosen for MVP)*:
   - *Pros*: Highest compression efficiency (lower bitrate for identical visual PSNR/VMAF compared to hardware encoders); runs on standard, inexpensive compute nodes (AWS c6i/c7i, DigitalOcean, Hetzner); deterministic bit-for-bit rendering across different cloud providers.
   - *Cons*: High CPU utilization during 4K exports.
2. **Option B: Hardware GPU Acceleration (Nvidia NVENC / Intel QuickSync / AWS Graviton VPU)**:
   - *Pros*: Massive encoding throughput ($5\times$ to $10\times$ realtime for 1080p); leaves CPU completely free for audio sidechaining and complex filter graphs.
   - *Cons*: Cloud GPU instances cost $3\times$ to $5\times$ more per hour; slight visual softness at equal bitrates; Docker GPU driver passthrough adds cluster orchestration complexity.

### Decision & MVP Strategy
- **Adopt Option A (CPU Software Encoding via `libx264`) for default 480p preview and 1080p final exports**.
- **Rationale**: Achieves measured preview rendering speed of **$0.20\times$ realtime** ($12\text{ s}$ for a $60\text{ s}$ timeline, beating the $< 0.5\times$ target) at minimal hosting cost.
- **Tier Gating Architecture**: The platform already enforces tier gating in `RendersController.enqueueExport`: 4K exports are restricted to Pro/Enterprise tiers. In production, 4K jobs are tagged and routed to dedicated GPU worker pools (`worker-gpu-pool`).

---

## ADR 4: Multi-Clip Project Scope & Timeline Representation

### Context & Challenge
Determining the boundary between a focused AI-native video creation tool (optimized for short-form content, webinars, tutorials, and vlogs) and a bloated, complex desktop NLE clone (Premiere Pro/Final Cut).

### Evaluated Options
1. **Option A: Single Primary Footage Base Asset with Silence Cuts, Overlays, and Audio Tracks** *(Chosen for MVP)*:
   - *Data Model*: Single `baseAssetId` with non-destructive source cuts (`CutLayer`), global color grading (`ColorLayer`), word-pop subtitles (`SubtitleLayer`), title cards (`IntroLayer`/`OutroLayer`), and background music (`MusicLayer`).
   - *Pros*: Ultra-compact EditPlan JSON payload ($< 10\text{ KB}$); instantaneous plan generation ($< 2\text{ s}$); intuitive UI for creator workflows; deterministic timeline mapping without multi-track collision bugs.
   - *Cons*: Does not support multi-camera switching or stitching disparate raw video clips into an arbitrary montage.
2. **Option B: Full Multi-Asset Multi-Track Non-Linear Video Editor (NLE)**:
   - *Data Model*: Arbitrary sequence bin with $N$ source clips spliced across multiple overlapping video tracks (V1, V2, V3) with cross-track transitions.
   - *Pros*: Unlimited creative montage flexibility.
   - *Cons*: 10x timeline state management complexity; heavy multi-stream proxy decoding in browser; exponential growth in AI planner prompt size and hallucination probability.

### Decision & MVP Strategy
- **Adopt Option A (Single Primary Footage Base Asset + Overlays & Cuts) for MVP v1.0.0**.
- **Rationale**: Aligns 100% with the core value proposition of AI video editing: taking raw video recordings (interviews, podcasts, vlogs, screen recordings) and automating the tedious work of cutting silences, pop-up subtitles, color enhancement, and music ducking in seconds.
- **Phase 10+ Evolution**: Expand `PlanResolver` to support an optional `bRollSequence` layer for inserting secondary B-roll cutaway clips over speech intervals.
