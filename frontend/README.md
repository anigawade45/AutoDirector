# AutoDirector Studio Frontend

A high-performance, dark luxury web application for AI-native video creation and timeline editing. Built with React 18, TypeScript, Vite, Tailwind CSS, Zustand, and TanStack Query.

---

## Architecture Overview

AutoDirector Studio delivers a desktop-grade timeline editing experience directly in modern web browsers. It couples a sub-frame accurate video playback engine with an AI Director conversational interface and RFC 6902 JSON Patch state synchronization.

```
frontend/
├── src/
│   ├── api/
│   │   └── client.ts             # 12-factor API client, SSE streaming auth, safe non-JSON parsing
│   ├── components/
│   │   ├── auth/
│   │   │   ├── AuthForm.tsx      # Unified auth form (validation, login/register, tier selection)
│   │   │   └── AuthModal.tsx     # WAI-ARIA accessible modal wrapper
│   │   ├── common/
│   │   │   ├── ConfirmModal.tsx  # Accessible confirmation alertdialog
│   │   │   └── ToastContainer.tsx# Realtime feedback toast notifications
│   │   ├── dashboard/
│   │   │   └── ProjectDashboard.tsx # Project grid, stats, search, creation, and deletion
│   │   ├── editor/
│   │   │   ├── EditorHeader.tsx  # Project status, export dialog, undo/redo controls
│   │   │   ├── VideoPlayer.tsx   # Realtime video canvas, safe guides, live LUT filters
│   │   │   ├── TimelineView.tsx  # Multi-track timeline, playhead scrubbing, magnetic snapping
│   │   │   ├── ChatPanel.tsx     # AI Director conversational interface & prompt suggestions
│   │   │   ├── InspectorPanel.tsx# Layer parameter inspector, RFC 6902 sync & optimistic rebase
│   │   │   ├── ProjectPanel.tsx  # Media asset metadata, transcripts, silences, and scene cuts
│   │   │   └── LeftSidebar.tsx   # Collapsible sidebar hosting Project & Inspector tabs
│   │   └── landing/
│   │       └── LandingPage.tsx   # Product landing page with embedded luxury showcase
│   ├── stores/
│   │   ├── authStore.ts          # Authentication session, JWT expiration, and init gate
│   │   ├── editorStore.ts        # Timeline zoom, playback status, RFC 6902 plan draft & undo stack
│   │   └── toastStore.ts         # Toast event dispatcher
│   ├── utils/
│   │   ├── authStorage.ts        # Guarded storage hydration, in-memory cache, JWT exp checking
│   │   └── planRebase.ts         # RFC 6902 optimistic JSON Patch rebase algorithm
│   ├── __tests__/                # Vitest unit and integration test suite
│   ├── App.tsx                   # Root component with HTML5 History routing & deep-linking
│   └── main.tsx                  # React entry point & TanStack Query client provider
```

---

## Key Technical Systems

### 1. Realtime Video Canvas & Overlay Engine (`VideoPlayer.tsx`)

- **Sub-frame Sync**: Synchronizes `<video>` playback with `<canvas>` overlays using `requestAnimationFrame`.
- **Live Color Grading**: Computes dynamic CSS filters (`computeColorCssFilter`) and radial vignettes in real time for non-destructive preview prior to cloud rendering.
- **Broadcast Safe Guides**: Toggleable SMPTE title-safe (90%) and action-safe (93%) guides.
- **Decoupled Playback Controller**: Video element references are registered directly in `editorStore`, allowing the Timeline, Director chat, and keyboard shortcuts (`Space`, `J`, `K`, `L`, arrow keys) to command playback without DOM coupling or fragile `querySelector` lookups.

### 2. Multi-Track Timeline & Playhead (`TimelineView.tsx`)

- **Multi-Track Virtualization**: Video, audio, text overlays, and color grade tracks rendered along a shared timeline.
- **Magnetic Snapping**: Automatically snaps playhead and clip boundaries to audio silence intervals, scene cuts, and adjacent clip markers.
- **Bi-directional Scrubbing**: Scrubbing the timeline ruler seeks video frames instantly with throttled event dispatch to maintain 60 FPS UI responsiveness.

### 3. RFC 6902 JSON Patch & Optimistic Concurrency (`planRebase.ts`)

- **Atomic Operations**: All plan modifications generate RFC 6902 JSON Patch operations (`add`, `remove`, `replace`) using `fast-json-patch`.
- **Optimistic Rebase**: When simultaneous edits or background AI prompts bump the head version, the client optimistically transforms local draft operations against the latest server plan without clobbering remote changes.
- **Prototype Pollution Defense**: Operations run with `banPrototypes: true` to prevent prototype poisoning during patch application.

### 4. HTML5 History Routing & Deep-Linking (`App.tsx`)

- Native browser URL routing with zero privileged-view flash:
  - `/`: Public landing page and feature tour.
  - `/dashboard`: Project dashboard and management.
  - `/projects/:id` (or `/editor/:id`): Direct deep link into project sequence editor.
  - `#/...`: Transparent SPA hash fallback for non-rewriting static hosts.
- Preserves deep links across authentication hydration.

### 5. Unified Authentication & Storage Hardening

- **Zero Query-String Token Exposure**: Server-Sent Events (SSE) stream progress via `fetch` streaming body `Authorization: Bearer` headers.
- **Guarded Hydration**: `AuthStorage` safely deserializes stored credentials with automatic corrupted-key eviction and client-side JWT `exp` validation.
- **Unified UX**: Single `AuthForm.tsx` handles validation, password length checks, and tier selection across both modal dialogs and inline landing page forms.

---

## Design System & Palette

The user interface follows a dark luxury aesthetic engineered for color-accurate video editing environments:

| Token                 | Hex Value | Purpose                                 |
| :-------------------- | :-------- | :-------------------------------------- |
| `Canvas / Background` | `#18191B` | Deep neutral obsidian base              |
| `Surface / Card`      | `#222326` | Elevated cards, sidebars, modals        |
| `Surface Border`      | `#393B3F` | High-definition hairline borders        |
| `Primary Text`        | `#FFF5F5` | Crisp, high-contrast typography         |
| `Highlight`           | `#F7D7D1` | Warm muted rose highlight               |
| `Accent`              | `#E3B5BE` | Active states, buttons, playhead accent |

---

## Environment Configuration

Configuration follows 12-factor principles. Environment variables are prefixed with `VITE_` and injected at build time:

| Variable            | Default | Description                                                                                                     |
| :------------------ | :------ | :-------------------------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `/api`  | Base endpoint for the backend API. Can be relative (`/api`) or an absolute URL (`https://api.example.com/api`). |

---

## Getting Started

### Prerequisites

- Node.js >= 18.x
- npm >= 9.x

### Installation

From the repository root:

```bash
npm install
```

### Development

Start the Vite development server with Hot Module Replacement (HMR):

```bash
npm run dev --prefix frontend
```

The application will be accessible at `http://localhost:5173`.

### Production Build

Typecheck and compile production assets into `frontend/dist/`:

```bash
npm run build --prefix frontend
```

### Running Tests

Execute the frontend Vitest suite:

```bash
npm test --prefix frontend
```

Or run a specific test file:

```bash
npx vitest run frontend/src/__tests__/appRoutingAndDeepLinking.test.ts
```
