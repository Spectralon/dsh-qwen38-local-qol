/**
 * The compaction backend: class identity and the summarize() delegation
 * (trim, then the stock engine path with the prepared messages).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import QwenLocalCompaction from '../src/backend.js'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import { NS } from '../src/settings-section.js'

/** A fake context serving one settings section (undefined = no namespace). */
function ctxWithSection(section) {
  return {
    get: (name) => name === 'settings'
      ? { get: (ns) => (ns === NS ? section : undefined) }
      : undefined,
  }
}

/** A prototype-built engine with the row config a preset mount would resolve. */
function engineWith(ctx) {
  const backend = Object.create(QwenLocalCompaction.prototype)
  backend.ctx = ctx
  backend.config = { thresholdRatio: 0.8, retainRatio: 0.16, headroomTokens: 0, maxTokens: 24576 }
  backend.baseConfig = backend.config
  return backend
}

test('backend: compactIfNeeded applies the live compactThresholdPct as the thresholdRatio', async () => {
  const original = BasicCompactionEngine.prototype.compactIfNeeded
  const seen = []
  try {
    BasicCompactionEngine.prototype.compactIfNeeded = async function () {
      seen.push({ thresholdRatio: this.config.thresholdRatio, maxTokens: this.config.maxTokens, retainRatio: this.config.retainRatio })
      return null
    }
    const backend = engineWith(ctxWithSection({ compactThresholdPct: 90 }))
    await backend.compactIfNeeded('agent', 'pressure', undefined)
    assert.deepEqual(seen, [{ thresholdRatio: 0.9, maxTokens: 24576, retainRatio: 0.16 }])
  } finally {
    BasicCompactionEngine.prototype.compactIfNeeded = original
  }
})

test('backend: compactIfNeeded unwraps a wrapped volatile leaf and ignores out-of-range values', async () => {
  const original = BasicCompactionEngine.prototype.compactIfNeeded
  const seen = []
  try {
    BasicCompactionEngine.prototype.compactIfNeeded = async function () {
      seen.push(this.config.thresholdRatio)
      return null
    }
    await engineWith(ctxWithSection({ compactThresholdPct: { get: () => 75 } })).compactIfNeeded('agent', 'pressure', undefined)
    await engineWith(ctxWithSection({ compactThresholdPct: 120 })).compactIfNeeded('agent', 'pressure', undefined)
    await engineWith(ctxWithSection({})).compactIfNeeded('agent', 'pressure', undefined)
    await engineWith(undefined).compactIfNeeded('agent', 'pressure', undefined)
    assert.deepEqual(seen, [0.75, 0.8, 0.8, 0.8])
  } finally {
    BasicCompactionEngine.prototype.compactIfNeeded = original
  }
})

test('backend: the live ratio rebuilds from the row base each evaluation (no drift)', async () => {
  const original = BasicCompactionEngine.prototype.compactIfNeeded
  const seen = []
  try {
    BasicCompactionEngine.prototype.compactIfNeeded = async function () {
      seen.push(this.config.thresholdRatio)
      return null
    }
    let pct = 90
    const ctx = { get: (name) => name === 'settings' ? { get: (ns) => (ns === NS ? { compactThresholdPct: pct } : undefined) } : undefined }
    const backend = engineWith(ctx)
    await backend.compactIfNeeded('agent', 'pressure', undefined)
    pct = 70
    await backend.compactIfNeeded('agent', 'pressure', undefined)
    pct = undefined
    await backend.compactIfNeeded('agent', 'pressure', undefined)
    assert.deepEqual(seen, [0.9, 0.7, 0.8])
  } finally {
    BasicCompactionEngine.prototype.compactIfNeeded = original
  }
})

test('backend: default export is the class and extends the stock engine', () => {
  assert.equal(typeof QwenLocalCompaction, 'function')
  assert.equal(QwenLocalCompaction.name, 'QwenLocalCompaction')
  assert.ok(QwenLocalCompaction.prototype instanceof BasicCompactionEngine)
})

test('backend: summarize trims the region, then delegates to the stock path', async () => {
  const original = BasicCompactionEngine.prototype.summarize
  const calls = []
  try {
    BasicCompactionEngine.prototype.summarize = async function (input, agent, signal) {
      calls.push({ input, agent, signal })
      return { blocks: [{ type: 'text', text: 'checkpoint' }] }
    }

    // Environment knob: keep zero assistant turns of reasoning, so a single
    // old reasoning block must be stripped by the trim.
    const envBackup = process.env.DSH_QWEN38_SUMMARIZE_KEEP_TURNS
    process.env.DSH_QWEN38_SUMMARIZE_KEEP_TURNS = '0'
    try {
      const backend = Object.create(QwenLocalCompaction.prototype)
      const messages = [
        { role: 'assistant', content: [{ type: 'reasoning', text: 'old thinking' }, { type: 'text', text: 't' }] },
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
      ]
      const result = await backend.summarize({ messages, other: 'kept' }, 'the-agent', 'the-signal')

      assert.equal(calls.length, 1)
      assert.equal(calls[0].agent, 'the-agent')
      assert.equal(calls[0].signal, 'the-signal')
      assert.equal(calls[0].input.other, 'kept')
      // The original input is not mutated.
      assert.equal(messages[0].content[0].type, 'reasoning')
      // The delegated input carries the prepared messages: reasoning stripped.
      const prepared = calls[0].input.messages
      assert.deepEqual(prepared[0].content, [{ type: 'text', text: 't' }])
      assert.equal(result.blocks[0].text, 'checkpoint')
    } finally {
      if (envBackup === undefined) delete process.env.DSH_QWEN38_SUMMARIZE_KEEP_TURNS
      else process.env.DSH_QWEN38_SUMMARIZE_KEEP_TURNS = envBackup
    }
  } finally {
    BasicCompactionEngine.prototype.summarize = original
  }
})
