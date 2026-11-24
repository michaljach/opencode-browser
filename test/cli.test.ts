import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const bin = fileURLToPath(new URL("../bin/opencode-browser.js", import.meta.url))
const latest = ["npx", "-y", "@browsermcp/mcp@latest"]

const runInit = (configPath: string) =>
  spawnSync(process.execPath, [bin, "init", "--path", configPath, "--print"], {
    encoding: "utf8",
  })

const makeConfig = (t: { after: (fn: () => void) => void }, config?: object) => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-browser-cli-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const configPath = join(dir, "opencode.json")

  if (config) {
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  }

  return configPath
}

test("init generates the latest Browser MCP command", (t) => {
  const configPath = makeConfig(t)
  const result = runInit(configPath)

  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(result.stdout)
  assert.deepEqual(config.plugin, ["opencode-browser"])
  assert.deepEqual(config.mcp.browsermcp.command, latest)
})

test("init upgrades the incompatible 0.1.3 pin", (t) => {
  const configPath = makeConfig(t, {
    mcp: {
      browsermcp: {
        type: "local",
        command: ["npx", "-y", "@browsermcp/mcp@0.1.3"],
      },
    },
  })
  const result = runInit(configPath)

  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(result.stdout)
  assert.deepEqual(config.mcp.browsermcp.command, latest)
})

test("init does not downgrade an existing @latest command", (t) => {
  const configPath = makeConfig(t, {
    mcp: {
      browsermcp: {
        type: "local",
        command: latest,
      },
    },
  })
  const result = runInit(configPath)

  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(result.stdout)
  assert.deepEqual(config.mcp.browsermcp.command, latest)
})

test("init preserves an explicitly pinned 2.x command", (t) => {
  const configPath = makeConfig(t, {
    mcp: {
      browsermcp: {
        type: "local",
        command: ["npx", "-y", "@browsermcp/mcp@2.5.0"],
      },
    },
  })
  const result = runInit(configPath)

  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(result.stdout)
  assert.deepEqual(config.mcp.browsermcp.command, ["npx", "-y", "@browsermcp/mcp@2.5.0"])
})