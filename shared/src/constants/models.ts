export interface GeminiModelOption {
  id: string;
  name: string;
  tag: string;
  description: string;
  badge?: string;
  contextWindow?: string;
  isStableFreeTier?: boolean;
}

export const AVAILABLE_GEMINI_MODELS: GeminiModelOption[] = [
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    tag: 'Ultra Fast & Stable',
    description:
      'Sub-second response time with high quota availability. Recommended for real-time video edits.',
    badge: 'Recommended',
    contextWindow: '1M tokens',
    isStableFreeTier: true,
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    tag: 'Multimodal Director',
    description:
      'Balanced multimodal director for complex video sequencing and layer choreography.',
    badge: 'Standard',
    contextWindow: '1M tokens',
    isStableFreeTier: true,
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite',
    tag: 'Rapid Suggestions',
    description:
      'Lightweight model optimized for rapid text-based timeline tweaks and color changes.',
    badge: 'Instant',
    contextWindow: '1M tokens',
    isStableFreeTier: true,
  },
  {
    id: 'gemini-flash-lite-latest',
    name: 'Gemini Flash-Lite Latest',
    tag: 'Auto-Updated Flash-Lite',
    description: 'Always points to Google’s most recent low-latency Flash-Lite deployment.',
    badge: 'Auto-Update',
    contextWindow: '1M tokens',
    isStableFreeTier: true,
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    tag: 'High Throughput',
    description:
      'High concurrency model designed for batch timeline updates and rapid clip pacing.',
    badge: 'High Speed',
    contextWindow: '1M tokens',
    isStableFreeTier: true,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    tag: 'Hybrid Reasoning',
    description: 'Reasoning model with deep artistic pacing and narrative timeline comprehension.',
    badge: 'Reasoning',
    contextWindow: '1M tokens',
    isStableFreeTier: true,
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    tag: 'Next-Gen Architecture',
    description:
      'Enhanced throughput architecture for massive multi-track timelines and complex layers.',
    badge: 'Next-Gen',
    contextWindow: '1M tokens',
    isStableFreeTier: true,
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    tag: 'Frontier Creative',
    description:
      'Next-generation experimental creative model with novel visual storytelling abilities.',
    badge: 'Frontier',
    contextWindow: '1M tokens',
    isStableFreeTier: true,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    tag: 'Pro Tier Only',
    description:
      'Highest capability model for complex cuts and intricate logic (requires Google Pro API quota).',
    badge: 'Pro Tier',
    contextWindow: '1M tokens',
    isStableFreeTier: false,
  },
  {
    id: 'gemini-3.5-transcribe',
    name: 'Gemini 3.5 Transcribe',
    tag: 'Audio & Speech',
    description:
      'Dedicated speech-to-text intelligence optimized for word timestamp synchronization.',
    badge: 'Audio AI',
    contextWindow: '98k tokens',
    isStableFreeTier: true,
  },
];
