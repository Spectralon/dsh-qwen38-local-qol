/**
 * Plugin configuration resolution: patch row first, then `DSH_QWEN38_*`
 * environment variables, then built-in defaults matching the production
 * Qwen3.8-27B line (NInfer 0.5.0 on 8082, 224K context).
 *
 * @module dsh-qwen38-local-qol/config
 */

import * as cosmokit from "@deepseek-ai/cosmokit";

/**
 * Detect a volatile config ref. Uses the official `isVolatile` helper when
 * available (cosmokit ≥ 1.8.5); falls back to duck-typing on older hosts
 * where the export does not exist yet — a volatile ref is an object whose
 * sole observable behavior is `.get()`.
 */
const isVolatile =
  cosmokit.isVolatile ??
  ((v) => v !== null && typeof v === "object" && typeof v.get === "function");

/**
 * Unwrap the parsed plugin Config for plain reads. On 0.2.0 hosts every
 * `.volatile()` leaf arrives as a live reference object (`{ get() }`, updated
 * in place by hot settings commits), not a primitive - reading one directly
 * stringifies to `[object Object]`. This is the official `plainOptions`
 * recipe (llm-deepseek/config.ts), applied recursively because the plugin
 * marks its nested line-block and budgets leaves volatile too.
 * @param value - a parsed config value (may be a volatile ref).
 * @returns the plain value; refs resolved through their live `get()`.
 */
export function plainConfig(value) {
  if (isVolatile(value)) return value.get();
  if (Array.isArray(value)) return value.map((item) => plainConfig(item));
  if (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, plainConfig(item)]),
    );
  }
  return value;
}

/**
 * NInfer line default server address when nothing configures one: the
 * standard local llama port, shared with the llama.cpp line's default (a
 * different port goes in the baseURL field or the DSH_QWEN38_BASE_URL env).
 */
export const DEFAULT_BASE_URL = "http://localhost:8080/v1";

/**
 * NInfer line model id when nothing configures one: the neutral line name,
 * no quant suffix. A server with a real artifact alias (see GET /v1/models)
 * gets the model field or the DSH_QWEN38_MODEL env var instead.
 */
export const DEFAULT_MODEL = "qwen3.8-27b";

/**
 * llama.cpp line default server address when nothing configures one: the
 * standard llama-server port (the same address as the NInfer line's default).
 */
export const DEFAULT_LLAMA_BASE_URL = "http://localhost:8080/v1";

/**
 * llama.cpp line model id when nothing configures one: the same neutral line
 * name as the NInfer line (a server's `-m <file>` alias or `--alias` override
 * gets the model field or the DSH_QWEN38_MODEL env var instead).
 */
export const DEFAULT_LLAMA_MODEL = "qwen3.8-27b";

/** The single provider route this plugin registers unless configured otherwise. */
export const DEFAULT_PROVIDER = "qwen38";

/**
 * Server dialect of the local Qwen3.8 line. `ninfer` = NInfer serve (effort
 * travels as the top-level `reasoning_effort` body field); `llamacpp` =
 * llama-server with the froggeric v22.1 jinja template (effort travels as
 * `chat_template_kwargs.reasoning_effort`, hard budget as
 * `reasoning_budget_tokens`); `tabbyapi` = TabbyAPI (the ExLlamaV3 backend
 * server), which accepts the NInfer wire natively: top-level
 * `reasoning_effort`, `chat_template_kwargs` template variables, and
 * `reasoning_budget_tokens` are all first-class request fields; `omlx` =
 * oMLX (the Apple Silicon MLX server for local Qwen3.8), which accepts
 * top-level `reasoning_effort` and native `thinking_budget` per request.
 */
export const DIALECT_NINFER = "ninfer";
export const DIALECT_LLAMACPP = "llamacpp";
export const DIALECT_TABBYAPI = "tabbyapi";
export const DIALECT_OMLX = "omlx";

/**
 * Every declared server dialect, in settings-tab order (the line selector
 * iterates this list).
 */
export const DIALECTS = Object.freeze([
  DIALECT_LLAMACPP,
  DIALECT_NINFER,
  DIALECT_TABBYAPI,
  DIALECT_OMLX,
]);

/** Shared context window of the standard lines (256K; the ExLlamaV3 cache sizing). */
export const DEFAULT_CONTEXT_WINDOW = 262144;

/**
 * Output cap ≈ 20% of the context window (0.2 × 262144): compaction triggers
 * at 0.8 × contextWindow, leaving this headroom for the final response so a
 * full-length answer never overruns the window.
 */
export const DEFAULT_MAX_TOKENS = 52428;

/**
 * TabbyAPI line defaults: the ExLlamaV3 server for Qwen3.8-Flash-Next 4.05bpw
 * EXL3 (256K context, the EXL3 cache allocation). The output cap follows the
 * same ~20%-of-window headroom rule as the other lines.
 */
export const DEFAULT_TABBYAPI_BASE_URL = "http://localhost:8083/v1";
export const DEFAULT_TABBYAPI_MODEL = "Qwen3.8-Flash-Next-4.05bpw";
export const DEFAULT_TABBYAPI_CONTEXT_WINDOW = 262144;
export const DEFAULT_TABBYAPI_MAX_TOKENS = 52428;

/**
 * oMLX line defaults: the Apple Silicon MLX server for Qwen3.8-27B (port
 * 8000). The window pair follows the shared standard-line defaults like
 * every other line; adjust per machine (a Mac MLX profile may run a smaller
 * context than 256K).
 */
export const DEFAULT_OMLX_BASE_URL = "http://localhost:8000/v1";
export const DEFAULT_OMLX_MODEL = "Qwen3.8-27B-MLX-8bit";
export const DEFAULT_OMLX_CONTEXT_WINDOW = 262144;
export const DEFAULT_OMLX_MAX_TOKENS = 52428;

/** Per-effort hard thinking budgets of the production line. */
export const DEFAULT_THINKING_BUDGETS = Object.freeze({
  low: 4096,
  medium: 8192,
  xhigh: 16384,
});

/**
 * Read one non-empty string setting, preferring the patch row over the
 * environment. An empty or whitespace-only value counts as unset.
 * @param value - the configured value.
 * @param envValue - the environment fallback.
 * @param fallback - the built-in default.
 * @returns the resolved setting.
 */
function setting(value, envValue, fallback) {
  for (const candidate of [value, envValue]) {
    if (typeof candidate === "string" && candidate.trim() !== "")
      return candidate.trim();
  }
  return fallback;
}

/**
 * Read one positive-integer setting, preferring the patch row over the
 * environment. Non-integer or non-positive values fall through to the next
 * candidate; all of them failing falls back to the built-in default.
 * @param value - the configured value.
 * @param envValue - the environment fallback.
 * @param fallback - the built-in default.
 * @returns the resolved integer.
 */
function intSetting(value, envValue, fallback) {
  for (const candidate of [value, envValue]) {
    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate > 0
    )
      return candidate;
    if (typeof candidate === "string" && /^\d+$/.test(candidate.trim())) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (parsed > 0) return parsed;
    }
  }
  return fallback;
}

/**
 * Read the per-effort thinking-budget map. Each entry must be a positive
 * integer; malformed entries are dropped so one bad key cannot poison the map.
 * @param value - the configured map.
 * @param fallback - the built-in default map.
 * @returns a new map with only the valid entries, or the fallback when nothing valid remains.
 */
function budgetMap(value, fallback) {
  if (value === undefined || value === null || typeof value !== "object")
    return { ...fallback };
  const out = {};
  for (const [effort, budget] of Object.entries(value)) {
    if (typeof budget === "number" && Number.isInteger(budget) && budget > 0)
      out[effort] = budget;
  }
  return Object.keys(out).length > 0 ? out : { ...fallback };
}

/**
 * Resolve plugin configuration. Note that an id-targeted cordis patch
 * replaces the whole config object, so the environment fallbacks apply to
 * whichever fields that patch leaves out.
 * @param config - the plugin config supplied by the bundle patch or overlay.
 * @param env - environment to read; defaults to `process.env`.
 * @returns the resolved provider configuration.
 */
export function resolveConfig(config = {}, env = process.env) {
  // 0.2.0 hosts hand the plugin volatile leaf refs; normalize once for every
  // downstream read (tests pass plain objects, which pass through untouched).
  config = plainConfig(config);
  // Line-selector form (the profile-config store): a non-empty `line` names
  // one per-dialect block and its knobs become the active ones (dialect forced
  // to the block), so switching lines in the settings form is a single field
  // edit. An empty/absent `line` keeps the legacy flat form authoritative (the
  // shipped patch row only carries top-level fields) - a byte-compatible base.
  if (typeof config.line === "string" && config.line.trim() !== "") {
    const block = config.lines?.[config.line.trim()];
    if (block !== undefined && block !== null && typeof block === "object") {
      config = { ...config, ...block, dialect: config.line.trim() };
    }
  }
  const dialect = setting(
    config.dialect,
    env.DSH_QWEN38_DIALECT,
    DIALECT_LLAMACPP,
  );
  if (DIALECTS.includes(dialect) === false) {
    throw new Error(
      `dsh-qwen38-local-qol: dialect must be one of ${DIALECTS.map((d) => `"${d}"`).join(", ")}, got "${dialect}"`,
    );
  }
  // The window defaults follow the dialect: each server line has its own
  // context capacity (the 224K lines vs the 256K ExLlamaV3 line vs the 64K oMLX line),
  // and the output cap keeps the line's narrow-band floor arithmetic.
  const contextWindowDefault =
    dialect === DIALECT_TABBYAPI
      ? DEFAULT_TABBYAPI_CONTEXT_WINDOW
      : dialect === DIALECT_OMLX
        ? DEFAULT_OMLX_CONTEXT_WINDOW
        : DEFAULT_CONTEXT_WINDOW;
  const maxTokensDefault =
    dialect === DIALECT_TABBYAPI
      ? DEFAULT_TABBYAPI_MAX_TOKENS
      : dialect === DIALECT_OMLX
        ? DEFAULT_OMLX_MAX_TOKENS
        : DEFAULT_MAX_TOKENS;
  const provider = Array.isArray(config.provider)
    ? config.provider
        .map((route) => String(route).trim())
        .filter((route) => route !== "")
    : [DEFAULT_PROVIDER];

  const contextWindow = intSetting(
    config.contextWindow,
    env.DSH_QWEN38_CONTEXT_WINDOW,
    contextWindowDefault,
  );
  const maxTokens = intSetting(
    config.maxTokens,
    env.DSH_QWEN38_MAX_TOKENS,
    maxTokensDefault,
  );
  const thinkingBudgets = budgetMap(
    config.thinkingBudgets,
    DEFAULT_THINKING_BUDGETS,
  );
  const defaultEffort = setting(
    config.defaultEffort,
    env.DSH_QWEN38_DEFAULT_EFFORT,
    "medium",
  );
  if (defaultEffort !== "off" && thinkingBudgets[defaultEffort] === undefined) {
    throw new Error(
      `dsh-qwen38-local-qol: defaultEffort "${defaultEffort}" is not a declared effort ("off" + thinkingBudgets keys)`,
    );
  }

  return {
    // The base-url default follows the dialect (the 224K lines share the
    // standard llama-server port; the ExLlamaV3 line has its own port; oMLX defaults to 8000).
    baseURL: setting(
      config.baseURL,
      env.DSH_QWEN38_BASE_URL,
      dialect === DIALECT_TABBYAPI
        ? DEFAULT_TABBYAPI_BASE_URL
        : dialect === DIALECT_OMLX
          ? DEFAULT_OMLX_BASE_URL
          : dialect === DIALECT_NINFER
            ? DEFAULT_BASE_URL
            : DEFAULT_LLAMA_BASE_URL,
    ),
    // The model default follows the dialect (the 224K lines share the neutral
    // line name; the ExLlamaV3 and oMLX lines name their local artifacts).
    model: setting(
      config.model,
      env.DSH_QWEN38_MODEL,
      dialect === DIALECT_TABBYAPI
        ? DEFAULT_TABBYAPI_MODEL
        : dialect === DIALECT_OMLX
          ? DEFAULT_OMLX_MODEL
          : dialect === DIALECT_NINFER
            ? DEFAULT_MODEL
            : DEFAULT_LLAMA_MODEL,
    ),
    /**
     * Human-readable selector name for the model entry. The wire model id is
     * an artifact alias (e.g. the server's quantized file name); the display
     * name is what the GUI selector shows. Unset falls back to the model id.
     */
    displayName: setting(
      config.displayName,
      env.DSH_QWEN38_DISPLAY_NAME,
      undefined,
    ),
    apiKey: setting(
      config.apiKey,
      env.DSH_QWEN38_API_KEY || env.OMLX_API_KEY,
      undefined,
    ),
    dialect,
    contextWindow,
    maxTokens,
    thinkingBudgets,
    /**
     * The selectable effort materialized into requests that omit one, and the
     * selector fallback. Declaring it suppresses the core selector's
     * "Default" row (which is redundant with `off` on this line).
     */
    defaultEffort,
    thinkingLevelMap:
      config.thinkingLevelMap && typeof config.thinkingLevelMap === "object"
        ? Object.fromEntries(
            Object.entries(config.thinkingLevelMap).filter(
              (entry) => typeof entry[1] === "string",
            ),
          )
        : {},
    /**
     * Ask the server to report usage in the final stream frame. On by default
     * for both dialects: the context-pressure projection (the session's
     * context meter) and the per-turn reasoning-token display both read the
     * server-reported usage. Verified 2026-09 against NInfer 0.5.0 (accepts
     * `stream_options.include_usage` and reports `usage`, including
     * `completion_tokens_details.reasoning_tokens`); llama-server honors it.
     */
    includeUsage:
      typeof config.includeUsage === "boolean" ? config.includeUsage : true,
    provider: provider.length > 0 ? provider : [DEFAULT_PROVIDER],
  };
}
