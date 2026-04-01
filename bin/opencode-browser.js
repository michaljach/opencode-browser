#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"

const schemaUrl = "https://opencode.ai/config.json"
const pluginName = "opencode-browser"
const browserMcpVersion = "0.1.3"
const legacyBrowserMcpCommand = ["npx", "-y", "@browsermcp/mcp@latest"]
const defaultBrowserMcpConfig = {
  type: "local",
  command: ["npx", "-y", `@browsermcp/mcp@${browserMcpVersion}`],
  enabled: true,
}

function isSameCommand(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
}

function printUsage() {
  console.log(`Usage: opencode-browser [init] [--project|--global|--path <file>] [--print]\n\n` +
    `Examples:\n` +
    `  npx opencode-browser init\n` +
    `  npx opencode-browser init --global\n` +
    `  npx opencode-browser init --path ./opencode.json\n` +
    `  npx opencode-browser init --print`)
}

function parseArgs(argv) {
  const args = [...argv]
  let command = "init"

  if (args[0] && !args[0].startsWith("-")) {
    command = args.shift()
  }

  const options = {
    mode: "project",
    configPath: undefined,
    printOnly: false,
  }

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === "--global") {
      options.mode = "global"
      continue
    }

    if (arg === "--project") {
      options.mode = "project"
      continue
    }

    if (arg === "--path") {
      const customPath = args.shift()

      if (!customPath) {
        throw new Error("Missing value for --path")
      }

      options.configPath = customPath
      continue
    }

    if (arg === "--print") {
      options.printOnly = true
      continue
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return { command, options }
}

function loadConfig(targetPath) {
  if (!existsSync(targetPath)) {
    return {}
  }

  const raw = readFileSync(targetPath, "utf8")

  try {
    const parsed = JSON.parse(raw)

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Config must be a JSON object")
    }

    return parsed
  } catch (error) {
    throw new Error(`Unable to parse ${targetPath}: ${error.message}`)
  }
}

function normalizePlugins(pluginField) {
  if (pluginField === undefined) {
    return []
  }

  if (typeof pluginField === "string") {
    return [pluginField]
  }

  if (Array.isArray(pluginField) && pluginField.every((value) => typeof value === "string")) {
    return [...pluginField]
  }

  throw new Error('The "plugin" field must be a string or an array of strings')
}

function ensureObject(value, fieldName) {
  if (value === undefined) {
    return {}
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The "${fieldName}" field must be an object`)
  }

  return { ...value }
}

function mergeConfig(config) {
  const nextConfig = { ...config }
  const changes = []

  if (!nextConfig.$schema) {
    nextConfig.$schema = schemaUrl
    changes.push("added OpenCode schema")
  }

  const plugins = normalizePlugins(nextConfig.plugin)
  if (!plugins.includes(pluginName)) {
    plugins.push(pluginName)
    changes.push("enabled opencode-browser plugin")
  }
  nextConfig.plugin = plugins

  const mcp = ensureObject(nextConfig.mcp, "mcp")
  const browsermcp = ensureObject(mcp.browsermcp, "mcp.browsermcp")

  if (browsermcp.type === undefined) {
    browsermcp.type = defaultBrowserMcpConfig.type
    changes.push("set Browser MCP type")
  }

  if (browsermcp.command === undefined) {
    browsermcp.command = [...defaultBrowserMcpConfig.command]
    changes.push("set Browser MCP command")
  } else if (isSameCommand(browsermcp.command, legacyBrowserMcpCommand)) {
    browsermcp.command = [...defaultBrowserMcpConfig.command]
    changes.push("pinned Browser MCP command version")
  }

  if (browsermcp.enabled === undefined) {
    browsermcp.enabled = defaultBrowserMcpConfig.enabled
    changes.push("enabled Browser MCP server")
  }

  mcp.browsermcp = browsermcp
  nextConfig.mcp = mcp

  return { nextConfig, changes }
}

function getTargetPath(mode, customPath) {
  if (customPath) {
    return resolve(customPath)
  }

  if (mode === "global") {
    return resolve(homedir(), ".config/opencode/opencode.json")
  }

  return resolve(process.cwd(), "opencode.json")
}

async function main() {
  try {
    const { command, options } = parseArgs(process.argv.slice(2))

    if (options.help) {
      printUsage()
      return
    }

    if (command !== "init") {
      throw new Error(`Unknown command: ${command}`)
    }

    const targetPath = getTargetPath(options.mode, options.configPath)
    const hadExistingConfig = existsSync(targetPath)
    const config = loadConfig(targetPath)
    const { nextConfig, changes } = mergeConfig(config)
    const output = `${JSON.stringify(nextConfig, null, 2)}\n`

    if (options.printOnly) {
      process.stdout.write(output)
      return
    }

    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, output)

    const action = hadExistingConfig ? "Updated" : "Created"
    console.log(`${action} ${targetPath}`)

    if (changes.length === 0) {
      console.log("No changes were needed; Browser MCP is already configured.")
      return
    }

    console.log(`Applied ${changes.length} change${changes.length === 1 ? "" : "s"}:`)
    for (const change of changes) {
      console.log(`- ${change}`)
    }
  } catch (error) {
    console.error(`[opencode-browser] ${error.message}`)
    printUsage()
    process.exitCode = 1
  }
}

await main()
