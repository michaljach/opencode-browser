import { test } from "node:test"
import assert from "node:assert/strict"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import type { Result as ToolResult } from "@opencode/plugin/promise/tool"
import type { Plugin as PluginV2 } from "@opencode/plugin/promise/plugin"
import type { SessionContext } from "@opencode/plugin/promise/session"
import plugin from "../src/index.ts"

type AnyFunction = (...args: any[]) => any

interface Registrations {
  session: Map<string, AnyFunction[]>
  tool: Map<string, AnyFunction[]>
  transforms: Array<(editor: any) => void>
}

const makeContext = (registrations: Registrations) => {
  return {
    session: {
      hook: async (name: string, callback: AnyFunction) => {
        const list = registrations.session.get(name) ?? []
        list.push(callback)
        registrations.session.set(name, list)
        return { dispose: async () => {} }
      },
    },
    tool: {
      hook: async (name: string, callback: AnyFunction) => {
        const list = registrations.tool.get(name) ?? []
        list.push(callback)
        registrations.tool.set(name, list)
        return { dispose: async () => {} }
      },
      transform: async (callback: (editor: any) => void) => {
        registrations.transforms.push(callback)
        return { dispose: async () => {} }
      },
    },
    event: {
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {},
      }),
    },
  }
}

const setupV2 = async () => {
  const registrations: Registrations = {
    session: new Map(),
    tool: new Map(),
    transforms: [],
  }

  const ctx = makeContext(registrations)
  await (plugin as any).setup(ctx)

  const sessionHook = (name: string): AnyFunction => {
    const found = registrations.session.get(name)?.[0]
    assert.ok(found, `expected a registered session hook: ${name}`)
    return found
  }

  const toolHook = (name: string): AnyFunction => {
    const found = registrations.tool.get(name)?.[0]
    assert.ok(found, `expected a registered tool hook: ${name}`)
    return found
  }

  return { registrations, sessionHook, toolHook }
}

const getText = (result: { content?: unknown; output?: unknown }): string => {
  const chunks: string[] = []
  if (typeof result.content === "string") chunks.push(result.content)
  if (Array.isArray(result.content)) {
    for (const part of result.content as Array<{ type: string; text?: string }>) {
      if (part.type === "text" && part.text) chunks.push(part.text)
    }
  }
  if (typeof result.output === "string") chunks.push(result.output)
  return chunks.join("\n")
}

const makeSystemContext = (): SessionContext => {
  return {
    sessionID: "ses_test",
    agent: "build",
    model: { providerID: "test", id: "test" },
    system: [{ type: "text", text: "base system prompt" }],
    messages: [],
    options: {},
    tools: {},
  } as unknown as SessionContext
}

test("V2 export exposes an id and setup function", () => {
  assert.equal(typeof (plugin as any).id, "string")
  assert.equal(typeof (plugin as any).setup, "function")
  assert.equal((plugin as any).id, "opencode-browser")
})

test("V1 export exposes a server function", () => {
  assert.equal(typeof (plugin as any).server, "function")
})

test("session context hook appends speed guidance once", async () => {
  const { sessionHook } = await setupV2()
  const hook = sessionHook("context")

  const event = makeSystemContext()
  hook(event)

  assert.match(event.system[0].text, /When using Browser MCP, optimize for speed/)

  // Second invocation must not duplicate the section.
  const systemLength = event.system.length
  hook(event)

  assert.equal(event.system.length, systemLength)
  assert.equal(event.system[0].text.match(/When using Browser MCP, optimize for speed/g)?.length, 1)
})

test("session context hook creates a system part when none exist", async () => {
  const { sessionHook } = await setupV2()
  const hook = sessionHook("context")

  const event = makeSystemContext()
  event.system.length = 0
  hook(event)

  assert.equal(event.system.length, 1)
  assert.match(event.system[0].text, /optimize for speed/)
})

test("tool transform annotates browser tools only", async () => {
  const { registrations } = await setupV2()
  const transform = registrations.transforms[0]
  assert.ok(transform)

  const updated: string[] = []
  const editor = {
    list: () => [
      { id: "browsermcp_browser_navigate", description: "Navigate the browser" },
      { id: "read", description: "Read a file" },
    ],
    update: (id: string, mutate: (tool: { description: string }) => void) => {
      updated.push(id)
      const tool = id === "browsermcp_browser_navigate"
        ? { id, description: "Navigate the browser" }
        : { id, description: "Read a file" }
      mutate(tool)
    },
  }

  transform(editor)

  assert.deepEqual(updated, ["browsermcp_browser_navigate"])
})

test("execute.after reports a connection failure in a completed result", async () => {
  const { toolHook } = await setupV2()
  const hook = toolHook("execute.after")

  const result: ToolResult = {
    output: "Error: connect ECONNREFUSED 127.0.0.1:9009",
    content: "Error: connect ECONNREFUSED 127.0.0.1:9009",
  }

  const event = {
    tool: "browsermcp_browser_navigate",
    sessionID: "ses_a",
    status: "completed" as const,
    result,
  }

  hook(event)

  const content = event.result.content
  assert.ok(typeof content === "string")
  assert.match(content, /browser connection looks unavailable/i)
})

test("execute.after appends guidance to a thrown connection error", async () => {
  const { toolHook } = await setupV2()
  const hook = toolHook("execute.after")

  const error = new ToolError({ message: "WebSocket closed unexpectedly" })
  const event = {
    tool: "browsermcp_browser_click",
    sessionID: "ses_b",
    status: "error" as const,
    error,
  }

  hook(event)

  assert.equal(event.error, error)
  assert.match(event.error.message, /browser connection looks unavailable/i)
  assert.match(event.error.message, /WebSocket closed unexpectedly/)
})

test("execute.after ignores unrelated tool errors", async () => {
  const { toolHook } = await setupV2()
  const hook = toolHook("execute.after")

  const error = new ToolError({ message: "Invalid selector" })
  const event = {
    tool: "browsermcp_browser_click",
    sessionID: "ses_c",
    status: "error" as const,
    error,
  }

  hook(event)

  assert.equal(event.error, error)
  assert.equal(event.error.message, "Invalid selector")
})

test("execute.after marks the connection restored after a success", async () => {
  const { toolHook } = await setupV2()
  const hook = toolHook("execute.after")

  hook({
    tool: "browsermcp_browser_navigate",
    sessionID: "ses_d",
    status: "completed" as const,
    result: { output: "Error: connect ECONNREFUSED" },
  })

  const event = {
    tool: "browsermcp_browser_navigate",
    sessionID: "ses_d",
    status: "completed" as const,
    result: { output: "page loaded" },
  }

  hook(event)

  const restored = (event.result as { content?: unknown; output?: unknown }).content ?? event.result.output
  assert.match(String(restored), /Connection restored/)
})

test("execute.after recovers a Code Mode browser failure", async () => {
  const { toolHook } = await setupV2()
  const hook = toolHook("execute.after")

  const event = {
    tool: "execute",
    sessionID: "ses_codemode",
    status: "completed" as const,
    result: {
      output: {
        output: "Failed to connect to browser extension.",
        toolCalls: [{ tool: "browsermcp.browser_click", status: "error", input: {} }],
        error: true,
      },
      content: [{ type: "text", text: "Failed to connect to browser extension." }],
      metadata: {
        toolCalls: [{ tool: "browsermcp.browser_click", status: "error", input: {} }],
        error: true,
      },
    },
  }

  hook(event)

  const text = getText(event.result)
  assert.match(text, /browser connection looks unavailable/i)
})

test("execute.after ignores Code Mode runs without browser tools", async () => {
  const { toolHook } = await setupV2()
  const hook = toolHook("execute.after")

  const result = {
    output: { output: "plain result", toolCalls: [{ tool: "search", status: "completed" }] },
    content: [{ type: "text" as const, text: "plain result" }],
    metadata: { toolCalls: [{ tool: "search", status: "completed" }] },
  }

  const event = { tool: "execute", sessionID: "ses_plain", status: "completed" as const, result }

  hook(event)

  assert.equal(event.result, result)
})

test("execute.after reports restored connection after a Code Mode success", async () => {
  const { toolHook } = await setupV2()
  const hook = toolHook("execute.after")

  hook({
    tool: "execute",
    sessionID: "ses_cm_restore",
    status: "completed" as const,
    result: {
      content: [{ type: "text" as const, text: "Failed to connect to browser extension." }],
      metadata: { toolCalls: [{ tool: "browsermcp.browser_click", status: "error" }] },
    },
  })

  const event = {
    tool: "execute",
    sessionID: "ses_cm_restore",
    status: "completed" as const,
    result: {
      content: [{ type: "text" as const, text: "navigation complete" }],
      metadata: { toolCalls: [{ tool: "browsermcp.browser_navigate", status: "completed" }] },
    },
  }

  hook(event)

  const text = getText(event.result)
  assert.match(text, /Connection restored/)
})

test("compaction hook ignores sessions that never used browser tools", async () => {
  const registrations: Registrations = {
    session: new Map(),
    tool: new Map(),
    transforms: [],
  }

  const ctx = makeContext(registrations)
  await (plugin as any).setup(ctx)

  const compaction = registrations.session.get("compaction")?.[0]
  assert.ok(compaction)

  const event = makeSystemContext()
  ;(event as { sessionID: string }).sessionID = "ses_never_used"
  compaction(event)

  assert.equal(event.system.length, 1)
})

test("compaction hook appends context for sessions that used browser tools", async () => {
  const registrations: Registrations = {
    session: new Map(),
    tool: new Map(),
    transforms: [],
  }

  const ctx = makeContext(registrations)
  await (plugin as any).setup(ctx)

  const toolAfter = registrations.tool.get("execute.after")?.[0]
  const compaction = registrations.session.get("compaction")?.[0]
  assert.ok(toolAfter)
  assert.ok(compaction)

  toolAfter({
    tool: "browsermcp_browser_navigate",
    sessionID: "ses_used",
    status: "completed" as const,
    result: { output: "ok" },
  })

  const event = makeSystemContext()
  ;(event as { sessionID: string }).sessionID = "ses_used"
  compaction(event)

  assert.equal(event.system.length, 2)
  assert.match(event.system[1].text, /Browser Automation Context/)

  // Idempotent when replayed.
  compaction(event)
  assert.equal(event.system.length, 2)
})

test("V1 server returns the legacy hook surface", async () => {
  const hooks = await (plugin as any).server({
    directory: "/tmp",
    project: {},
    client: {},
    worktree: "/tmp",
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost"),
    $: {},
  })

  for (const name of [
    "experimental.chat.system.transform",
    "tool.definition",
    "tool.execute.after",
    "experimental.session.compacting",
    "event",
  ]) {
    assert.equal(typeof hooks[name], "function", `missing V1 hook: ${name}`)
  }

  const systemOutput = { system: ["base"] }
  await hooks["experimental.chat.system.transform"]({ sessionID: "x" }, systemOutput)
  assert.match(systemOutput.system[0], /optimize for speed/)

  const toolOutput = { output: "WebSocket closed", title: "", metadata: {} }
  await hooks["tool.execute.after"](
    { tool: "browsermcp_browser_click", sessionID: "ses_v1", callID: "c", args: {} },
    toolOutput,
  )
  assert.match(toolOutput.output, /browser connection looks unavailable/i)

  const compactionOutput = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: "ses_v1" }, compactionOutput)
  assert.equal(compactionOutput.context.length, 1)
  assert.match(compactionOutput.context[0], /Browser Automation Context/)
})
