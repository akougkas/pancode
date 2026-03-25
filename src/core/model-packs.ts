export interface ModelPack {
  id: string;
  name: string;
  description: string;
  models: {
    admin: string;
    plan: string;
    build: string;
    review: string;
  };
}

const BUILTIN_PACKS: ModelPack[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude family across all four modes.",
    models: {
      admin: "claude-opus-4-6",
      plan: "claude-opus-4-6",
      build: "claude-sonnet-4-5",
      review: "claude-haiku-4-5",
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT/O-series models across all four modes.",
    models: {
      admin: "o3",
      plan: "gpt-5.3-codex",
      build: "gpt-5.3-codex",
      review: "gpt-5.1-codex-mini",
    },
  },
  {
    id: "local",
    name: "Local",
    description: "Best available local model per mode, resolved dynamically at runtime.",
    models: {
      admin: "auto-local",
      plan: "auto-local",
      build: "auto-local",
      review: "auto-local",
    },
  },
  {
    id: "hybrid",
    name: "Hybrid",
    description: "Cloud models for admin/review, local models for plan/build.",
    models: {
      admin: "claude-opus-4-6",
      plan: "auto-local",
      build: "auto-local",
      review: "claude-haiku-4-5",
    },
  },
];

export function getBuiltinPacks(): ModelPack[] {
  return BUILTIN_PACKS;
}
