import type { Plugin as PluginDefinition } from "@opencode/plugin/promise/plugin"
import type { Result as ToolResult } from "@opencode/plugin/promise/tool"
import type { Plugin as PluginV1 } from "@opencode-ai/plugin"

interface ConnectionState {
  isConnected: boolean
  lastError?: string
  failureCount: number
}

const PLUGIN_ID = "opencode-browser"

const BROWSER_TOOL_PREFIX = "browsermcp_"

/** Code Mode reports browser tools with a dotted namespace instead of an underscore. */
const CODEMODE_BROWSER_TOOL_PREFIX = "browsermcp."

const browserSpeedGuidance = `When using Browser MCP, optimize for speed:
- Prefer direct URL navigation over click-through flows when the destination is known.
- Reuse the current tab and page state instead of repeating navigation.
- Minimize snapshots, screenshots, and waits; use them only after a page change or when visual confirmation is required.
- Prefer targeted extraction or direct actions over broad inspection.
- Finish the task in the fewest browser actions that still preserve correctness.`

const browserCompactionContext = `## Browser Automation Context

Browser MCP was used in this session. When resuming:
- Assume the current browser tab may still be useful.
- Check browser state once, then reuse it instead of repeating navigation.
- Prefer direct navigation, extraction, and targeted actions over repeated snapshots or screenshots.
- Use waits only when the page is still loading or an interaction has not settled yet.`

const browserToolHints = [
  {
    suffixes: ["_browser_navigate", "_navigate"],
    hint: "Prefer this when you already know the destination URL instead of clicking through intermediate pages.",
  },
  {
    suffixes: ["_browser_snapshot", "_snapshot"],
    hint: "This is relatively expensive. Reuse the latest snapshot unless the page changed or you need fresh element references.",
  },
  {
    suffixes: ["_browser_screenshot", "_screenshot"],
    hint: "Use only when the user needs visual confirmation. Prefer extraction or targeted checks for faster workflows.",
  },
  {
    suffixes: ["_browser_wait", "_wait"],
    hint: "Use only when content is still loading or an interaction has not settled. Avoid fixed waits when the next action can validate readiness.",
  },
] as const

const connectionErrorPatterns = [
  /econnrefused/i,
  /connection refused/i,
  /failed to connect/i,
  /could not connect/i,
  /no connection to .*browser/i,
  /browser\s*mcp.*(?:disconnected|unavailable|not connected)/i,
  /extension.*(?:disabled|disconnected|not connected|unavailable)/i,
  /websocket.*(?:closed|failed)/i,
  /timed out while connecting/i,
]

const CONNECTION_UNAVAILABLE_HINT =
  "[Browser MCP] The browser connection looks unavailable. Re-enable the Browser MCP extension or browser, then retry. The plugin skips delayed backoff so the next attempt can run immediately."

const CONNECTION_RESTORED_HINT =
  "[Browser MCP] Connection restored. Continuing without extra retry delay."

const isBrowserTool = (toolID: string): boolean => toolID.startsWith(BROWSER_TOOL_PREFIX)

const isCodeModeBrowserTool = (toolID: string): boolean =>
  toolID.startsWith(CODEMODE_BROWSER_TOOL_PREFIX) || isBrowserTool(toolID)

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

const appendSection = (base: string, section: string): string => {
  const trimmedSection = section.trim()

  if (!trimmedSection) {
    return base
  }

  if (!base) {
    return trimmedSection
  }

  if (base.includes(trimmedSection)) {
    return base
  }

  return `${base.trimEnd()}\n\n${trimmedSection}`
}

const appendToolOutputSection = <Value>(value: Value, section: string): Value => {
  if (typeof value === "string") {
    return appendSection(value, section) as Value
  }

  if (!isRecord(value)) {
    return value
  }

  for (const field of ["error", "message", "details"] as const) {
    if (typeof value[field] === "string") {
      return {
        ...value,
        [field]: appendSection(value[field], section),
      } as Value
    }
  }

  return value
}

const stringifyOutput = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const getFailureFlag = (value: Record<string, unknown>): boolean => {
  if (value.success === false || value.ok === false) {
    return true
  }

  if (value.isError === true || value.error === true) {
    return true
  }

  return false
}

const getConnectionErrorText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value
  }

  if (!isRecord(value)) {
    return undefined
  }

  if (typeof value.error === "string") {
    return value.error
  }

  if (typeof value.stderr === "string") {
    return value.stderr
  }

  // Tool results may carry their text payload under `output`, either as the
  // plain output string (the V1 hook's shape) or as an error report.
  if (typeof value.output === "string") {
    return value.output
  }

  if (!getFailureFlag(value)) {
    return undefined
  }

  for (const field of ["message", "details", "output"] as const) {
    if (typeof value[field] === "string") {
      return value[field]
    }
  }

  return undefined
}

const isConnectionError = (value: unknown): boolean => {
  const errorString = getConnectionErrorText(value)

  if (!errorString) {
    return false
  }

  return connectionErrorPatterns.some((pattern) => pattern.test(errorString))
}

const getToolHint = (toolID: string): string => {
  for (const { suffixes, hint } of browserToolHints) {
    if (suffixes.some((suffix) => toolID.endsWith(suffix))) {
      return hint
    }
  }

  return "Prefer the smallest action that advances the task, and avoid redundant browser calls when the current page state is already known."
}

/** Collects the human-readable text a tool result carries, across both result shapes. */
const getResultText = (result: ToolResult): string => {
  const chunks: string[] = []

  const push = (value: unknown) => {
    if (typeof value === "string" && value) {
      chunks.push(value)
    }
  }

  const { content } = result

  if (typeof content === "string") {
    push(content)
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "text") {
        push(part.text)
      }
    }
  }

  push(result.output)

  if (isRecord(result.output)) {
    push(result.output.output)
    push(result.output.error)
    push(result.output.message)
  }

  return chunks.join("\n")
}

interface CodeModeToolCall {
  tool: string
  status?: string
}

/**
 * Code Mode reports the tools a script invoked on the result metadata, using
 * `namespace.tool` names such as `browsermcp.browser_navigate`.
 */
const getCodeModeToolCalls = (result: ToolResult): CodeModeToolCall[] => {
  const source = isRecord(result.metadata)
    ? result.metadata
    : isRecord(result.output)
      ? result.output
      : undefined
  const calls = source?.toolCalls

  if (!Array.isArray(calls)) {
    return []
  }

  return calls.flatMap((call) => {
    if (!isRecord(call) || typeof call.tool !== "string") {
      return []
    }

    return [{ tool: call.tool, status: typeof call.status === "string" ? call.status : undefined }]
  })
}

interface SessionState {
  browserSessions: Set<string>
  connectionStates: Map<string, ConnectionState>
  getConnectionState: (sessionID: string) => ConnectionState
  markConnectionFailed: (sessionID: string, error: unknown) => void
  resetConnectionState: (sessionID: string) => void
}

const createSessionState = (): SessionState => {
  const browserSessions = new Set<string>()
  const connectionStates = new Map<string, ConnectionState>()

  const getConnectionState = (sessionID: string): ConnectionState => {
    const existingState = connectionStates.get(sessionID)

    if (existingState) {
      return existingState
    }

    const nextState: ConnectionState = {
      isConnected: true,
      failureCount: 0,
    }

    connectionStates.set(sessionID, nextState)
    return nextState
  }

  const markConnectionFailed = (sessionID: string, error: unknown) => {
    const connectionState = getConnectionState(sessionID)
    connectionState.isConnected = false
    connectionState.failureCount += 1
    connectionState.lastError = stringifyOutput(error)
  }

  const resetConnectionState = (sessionID: string) => {
    const connectionState = getConnectionState(sessionID)
    connectionState.isConnected = true
    connectionState.failureCount = 0
    connectionState.lastError = undefined
  }

  return { browserSessions, connectionStates, getConnectionState, markConnectionFailed, resetConnectionState }
}

/**
 * Records a connection failure and returns the guidance section that should be
 * surfaced to the model.
 */
const onConnectionError = (state: SessionState, sessionID: string, value: unknown): string => {
  state.markConnectionFailed(sessionID, value)
  const connectionState = state.getConnectionState(sessionID)

  return connectionState.failureCount === 1
    ? CONNECTION_UNAVAILABLE_HINT
    : `[Browser MCP] Browser connection is still unavailable (failure ${connectionState.failureCount}). Retry as soon as the extension is ready.`
}

/**
 * Returns the recovery guidance section when a previously failing connection
 * looks healthy again, or undefined when nothing changed.
 */
const onConnectionRestored = (state: SessionState, sessionID: string): string | undefined => {
  if (state.getConnectionState(sessionID).isConnected) {
    return undefined
  }

  state.resetConnectionState(sessionID)
  return CONNECTION_RESTORED_HINT
}

/**
 * A completed result can report a connection failure either through
 * `output` or through text carried in `content`.
 */
const resultHasConnectionError = (result: ToolResult): boolean => {
  if (isConnectionError(result.output)) {
    return true
  }

  const { content } = result

  if (content === undefined) {
    return false
  }

  if (typeof content === "string") {
    return isConnectionError(content)
  }

  return content.some((part) => part.type === "text" && isConnectionError(part.text))
}

const appendResultSection = (result: ToolResult, section: string): ToolResult => {
  const { content } = result

  if (content === undefined) {
    return { ...result, content: section }
  }

  if (typeof content === "string") {
    return { ...result, content: appendSection(content, section) }
  }

  const alreadyPresent = content.some((part) => part.type === "text" && part.text.includes(section))

  if (alreadyPresent) {
    return result
  }

  return { ...result, content: [...content, { type: "text", text: section }] }
}

/**
 * V1 implementation, used by OpenCode 1 through the `server()` entrypoint.
 */
const BrowserMCPPluginV1: PluginV1 = async () => {
  const state = createSessionState()

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const last = output.system.length - 1
      if (last >= 0) {
        if (!output.system[last].includes(browserSpeedGuidance)) {
          output.system[last] = appendSection(output.system[last], browserSpeedGuidance)
        }
      } else {
        output.system.push(browserSpeedGuidance)
      }
    },

    "tool.definition": async (input, output) => {
      if (!isBrowserTool(input.toolID)) {
        return
      }

      output.description = appendSection(output.description, `Performance: ${getToolHint(input.toolID)}`)
    },

    "tool.execute.after": async (input, output) => {
      if (!isBrowserTool(input.tool)) {
        return
      }

      state.browserSessions.add(input.sessionID)

      if (isConnectionError(output.output)) {
        output.output = appendToolOutputSection(output.output, onConnectionError(state, input.sessionID, output.output))
        return
      }

      const restored = onConnectionRestored(state, input.sessionID)

      if (restored) {
        output.output = appendToolOutputSection(output.output, restored)
      }
    },

    "experimental.session.compacting": async (input, output) => {
      if (state.browserSessions.has(input.sessionID)) {
        output.context.push(browserCompactionContext)
      }
    },

    event: async ({ event }) => {
      const sessionID = typeof (event as unknown as { sessionID?: unknown }).sessionID === "string"
        ? (event as unknown as { sessionID: string }).sessionID
        : undefined

      if (!sessionID) {
        return
      }

      if (event.type === "session.deleted") {
        state.browserSessions.delete(sessionID)
        state.connectionStates.delete(sessionID)
      }
    },
  }
}

/**
 * V2 implementation. Registers the same browser guidance through the V2
 * session, tool, and event domains.
 */
const BrowserMCPPluginV2: PluginDefinition = {
  id: PLUGIN_ID,
  async setup(ctx) {
    const state = createSessionState()

    await ctx.session.hook("context", (event) => {
      const last = event.system.length - 1

      if (last >= 0) {
        const part = event.system[last]

        if (part.type === "text" && !part.text.includes(browserSpeedGuidance)) {
          event.system[last] = { ...part, text: appendSection(part.text, browserSpeedGuidance) }
        }
      } else {
        event.system.push({ type: "text", text: browserSpeedGuidance })
      }
    })

    await ctx.tool.transform((editor) => {
      for (const tool of editor.list()) {
        if (!isBrowserTool(tool.id)) {
          continue
        }

        editor.update(tool.id, (definition) => {
          definition.description = appendSection(definition.description, `Performance: ${getToolHint(tool.id)}`)
        })
      }
    })

    await ctx.tool.hook("execute.after", (event) => {
      // A browser tool invoked directly (the V1-style naming).
      if (isBrowserTool(event.tool)) {
        state.browserSessions.add(event.sessionID)

        if (event.status === "error") {
          if (!isConnectionError(event.error.message)) {
            return
          }

          const section = onConnectionError(state, event.sessionID, event.error.message)

          // Tool.Error exposes readonly fields, but the runtime surfaces the
          // updated message to the model without reconstructing the error.
          const mutableError = event.error as unknown as { message: string }
          mutableError.message = appendSection(mutableError.message, section)

          return
        }

        if (resultHasConnectionError(event.result)) {
          const section = onConnectionError(state, event.sessionID, event.result.output ?? event.result.content)
          event.result = appendResultSection(event.result, section)
          return
        }

        const restored = onConnectionRestored(state, event.sessionID)

        if (restored) {
          event.result = appendResultSection(event.result, restored)
        }

        return
      }

      // Code Mode runs browser tools inside the `execute` tool. The nested
      // calls are reported on the execute result rather than as their own
      // events, so recover the browser context from there.
      if (event.tool !== "execute" || event.status !== "completed") {
        return
      }

      const calls = getCodeModeToolCalls(event.result).filter((call) => isCodeModeBrowserTool(call.tool))

      if (calls.length === 0) {
        return
      }

      state.browserSessions.add(event.sessionID)

      const text = getResultText(event.result)
      const lastCall = calls[calls.length - 1]
      const lastCallFailed = lastCall?.status === "error" && isConnectionError(text)

      if (lastCallFailed) {
        // The same failure may have been recorded already by a direct browser
        // tool event for this call; only count it once.
        const current = state.getConnectionState(event.sessionID)
        const alreadyRecorded = !current.isConnected &&
          typeof current.lastError === "string" &&
          current.lastError.length > 0 &&
          text.includes(current.lastError)

        if (!alreadyRecorded) {
          event.result = appendResultSection(event.result, onConnectionError(state, event.sessionID, text))
        }

        return
      }

      // The last browser call succeeded. If an earlier call had marked the
      // connection as failed, this attempt proves it is working again.
      const restored = onConnectionRestored(state, event.sessionID)

      if (restored) {
        event.result = appendResultSection(event.result, restored)
      }
    })

    await ctx.session.hook("compaction", (event) => {
      if (!state.browserSessions.has(event.sessionID)) {
        return
      }

      const alreadyPresent = event.system.some(
        (part) => part.type === "text" && part.text.includes(browserCompactionContext),
      )

      if (!alreadyPresent) {
        event.system.push({ type: "text", text: browserCompactionContext })
      }
    })

    const controller = new AbortController()

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type !== "session.deleted") {
            continue
          }

          const sessionID = event.data.sessionID
          state.browserSessions.delete(sessionID)
          state.connectionStates.delete(sessionID)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(`[${PLUGIN_ID}] event subscription failed`, error)
        }
      }
    })()

    return () => controller.abort()
  },
}

/**
 * Dual entrypoint: OpenCode 2 reads `id` and `setup()`, OpenCode 1.18.29+
 * calls `server()`.
 */
export default {
  ...BrowserMCPPluginV2,
  server: BrowserMCPPluginV1,
}
