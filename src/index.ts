import type { Plugin } from "@opencode-ai/plugin"

interface ConnectionState {
  isConnected: boolean
  lastError?: string
  failureCount: number
}

const BROWSER_TOOL_PREFIX = "browsermcp_"

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

const browserToolHints: Record<string, string> = {
  browsermcp_browser_navigate:
    "Prefer this when you already know the destination URL instead of clicking through intermediate pages.",
  browsermcp_browser_snapshot:
    "This is relatively expensive. Reuse the latest snapshot unless the page changed or you need fresh element references.",
  browsermcp_browser_screenshot:
    "Use only when the user needs visual confirmation. Prefer extraction or targeted checks for faster workflows.",
  browsermcp_browser_wait:
    "Use only when content is still loading or an interaction has not settled. Avoid fixed waits when the next action can validate readiness.",
}

const connectionErrorPatterns = [
  /econnrefused/i,
  /connection refused/i,
  /failed to connect/i,
  /could not connect/i,
  /browser\s*mcp.*(?:disconnected|unavailable|not connected)/i,
  /extension.*(?:disabled|disconnected|not connected|unavailable)/i,
  /websocket.*(?:closed|failed)/i,
  /timed out while connecting/i,
]

const isBrowserTool = (toolID: string): boolean => toolID.startsWith(BROWSER_TOOL_PREFIX)

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

const isConnectionError = (value: unknown): boolean => {
  const errorString = stringifyOutput(value)

  return connectionErrorPatterns.some((pattern) => pattern.test(errorString))
}

const getToolHint = (toolID: string): string => {
  if (browserToolHints[toolID]) {
    return browserToolHints[toolID]
  }

  return "Prefer the smallest action that advances the task, and avoid redundant browser calls when the current page state is already known."
}

export const BrowserMCPPlugin: Plugin = async () => {
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

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (!output.system.includes(browserSpeedGuidance)) {
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

      browserSessions.add(input.sessionID)
      const connectionState = getConnectionState(input.sessionID)

      if (isConnectionError(output.output)) {
        markConnectionFailed(input.sessionID, output.output)

        const connectionHint = connectionState.failureCount === 1
          ? "[Browser MCP] The browser connection looks unavailable. Re-enable the Browser MCP extension or browser, then retry. The plugin skips delayed backoff so the next attempt can run immediately."
          : `[Browser MCP] Browser connection is still unavailable (failure ${connectionState.failureCount}). Retry as soon as the extension is ready.`

        output.output = appendSection(output.output, connectionHint)
        return
      }

      if (!connectionState.isConnected) {
        resetConnectionState(input.sessionID)
        output.output = appendSection(
          output.output,
          "[Browser MCP] Connection restored. Continuing without extra retry delay.",
        )
      }
    },

    "experimental.session.compacting": async (input, output) => {
      if (browserSessions.has(input.sessionID)) {
        output.context.push(browserCompactionContext)
      }
    },

    event: async ({ event }) => {
      const sessionID = typeof (event as { sessionID?: unknown }).sessionID === "string"
        ? (event as { sessionID: string }).sessionID
        : undefined

      if (!sessionID) {
        return
      }

      if (event.type === "session.deleted") {
        browserSessions.delete(sessionID)
        connectionStates.delete(sessionID)
      }
    },
  }
}

export default BrowserMCPPlugin
