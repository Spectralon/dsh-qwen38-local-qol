/**
 * DeepSeek Harness plugin registering the Qwen3.8 local-line backend on the
 * `llm` seam.
 *
 * This is an LLM adapter, not a tool: it registers a provider route with
 * `ctx.llm.registerAdapter()` and never touches `ctx.tools`. The companion
 * compaction backend lives in {@link dsh-qwen38-local-qol/backend} and is
 * mounted by the generated user preset, not by this bundle patch.
 *
 * @module dsh-qwen38-local-qol
 */
import { QwenLocalAdapter } from "./adapter.js";
import { resolveConfig, DEFAULT_PROVIDER } from "./config.js";
import { NS, sectionSchema, validateSection } from "./settings-section.js";
import {
  resolveDshHome,
  readCompactionStatus,
  autoApplyCompaction,
  PRESET_ID,
} from "./setup.js";

export {
  QwenLocalAdapter,
  PROVIDER_NAME,
  PROVIDER_HTTP_ERROR_CODE,
  PROVIDER_UNREACHABLE_CODE,
} from "./adapter.js";
export {
  UNSUPPORTED_CONTENT_CODE,
  PROVIDER_PROTOCOL_ERROR_CODE,
  PROVIDER_ERROR_CODE,
} from "./wire.js";
export {
  resolveConfig,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
} from "./config.js";
export { NS, sectionSchema, validateSection } from "./settings-section.js";

/**
 * The plugin's settings schema (schemastery). The harness auto-derives the
 * settings form from this; the resolved value is passed to `apply(ctx, config)`.
 */
export const Config = sectionSchema();

/** Plugin name, as it appears in the harness plugin registry. */
export const name = "qwen38-local-qol";

/** Hard dependency: without the `llm` seam there is nothing to register on. */
export const inject = ["llm"];

/**
 * Register the Qwen3.8 local adapter for its configured provider routes.
 * @param ctx - the harness context, with the injected `llm` seam.
 * @param config - the resolved plugin config (from the settings system).
 * @returns the registration handle, released with the fiber.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config);
  // Self-apply the compaction wiring BEFORE the status snapshot, so a first
  // run (a fresh home without the generated preset) reports the post-apply
  // state on this boot. Idempotent: an existing preset and an explicit
  // default are respected. A missing standard source or a write failure is
  // logged, not fatal — the dot stays grey until the next start fixes it.
  try {
    const autoApply = autoApplyCompaction(resolveDshHome());
    if (autoApply.applied) {
      console.log(
        `dsh-qwen38-local-qol: generated the ${PRESET_ID} preset at ${autoApply.preset}`,
      );
    }
    if (autoApply.defaultChanged !== "none") {
      console.log(
        `dsh-qwen38-local-qol: set the default agent preset to ${PRESET_ID} (${autoApply.defaultChanged})`,
      );
    }
  } catch (error) {
    console.warn(
      `dsh-qwen38-local-qol: compaction auto-apply skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // The attachment seam is optional (the tool-fs precedent): where the profile
  // has no attachment store the child fiber stays pending and image blocks
  // degrade to text placeholders for the process lifetime.
  const adapter = new QwenLocalAdapter(resolved);
  ctx.inject(["attachments"], (attachmentCtx) => {
    adapter.setAttachment(attachmentCtx.attachments);
  });
  return ctx.llm.registerAdapter(resolved.provider, adapter);
}
