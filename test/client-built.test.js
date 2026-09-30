/**
 * The built client artifact (lib/client.js): the DSH client-module format —
 * a self-registering classic script whose factory returns the plugin face,
 * with `react` resolved through the supplied require (the module table in
 * the browser). Guards the format contract the loader executes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Script } from 'node:vm'
import * as React from 'react'

/** The module-table require: `react` and the shared primitives package. */
const externalRequire = (specifier) => {
  if (specifier === 'react') return React
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {
    Button: () => null,
    Input: () => null,
    StateDot: () => null,
    Switch: () => null,
  }
  throw new Error(`unexpected external ${specifier}`)
}

/** Execute the built bundle exactly the way the browser loader does. */
function runBundle() {
  const bundle = readFileSync('lib/client.js', 'utf8')
  const registrations = []
  const window = { __ModuleLoader__: { load: (registration) => { registrations.push(registration) } } }
  // Classic-script execution in a fresh global context (node:vm) — the same
  // shape the browser loader gives the file: a plain script, no top-level
  // import/await, no Function constructor.
  new Script(bundle).runInNewContext({ window })
  return registrations
}

test('built bundle: self-registers the package id and returns the plugin face', () => {
  const registrations = runBundle()
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, 'dsh-qwen38-local-qol')
  const face = registrations[0].factory(externalRequire)
  assert.equal(face.name, 'qwen38-local-qol')
  // The bundle executes in a vm realm: rebuild `inject` in this realm so the
  // prototype-sensitive deepStrictEqual compares equal across realms.
  assert.deepEqual([...face.inject], ['slots', 'locale', 'remote', 'remote.settings'])
  assert.equal(typeof face.apply, 'function')
})

test('built bundle: apply registers the settings section with a working load face', async () => {
  const registrations = runBundle()
  const face = registrations[0].factory(externalRequire)
  let options = null
  let component = null
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh' }) },
    slots: {
      inject(name, callback) { assert.equal(name, 'settings.section'); callback() },
      register(option, Component) { options = option; component = Component },
    },
    remote: {
      settings: {
        describe: async () => ({ ok: true, value: { namespaces: [{ ns: 'qwen38', revision: 1, value: { model: 'm' } }] } }),
        update: async (ns, patch, revision) => { assert.equal(ns, 'qwen38'); assert.equal(revision, 1); return { ok: true, value: { ns, revision: 2, value: patch } } },
      },
    },
  }
  face.apply(ctx)
  assert.equal(options.id, 'qwen38-local-qol')
  assert.equal(typeof component, 'function')
  const loaded = await options.inject().load()
  assert.equal(loaded.ok, true)
  assert.equal(loaded.value.revision, 1)
})
