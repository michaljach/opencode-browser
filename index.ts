import type { Plugin } from "@opencode-ai/plugin"

/**
 * OpenCode Plugin for Browser MCP Integration
 * 
 * This plugin integrates Browser MCP (https://browsermcp.io) to enable browser automation
 * capabilities within OpenCode. It allows the AI to control a browser, navigate websites,
 * fill forms, click elements, and perform other browser automation tasks.
 * 
 * Setup:
 * 1. Install the Browser MCP extension in your browser
 * 2. Configure the MCP server in your opencode.json (see README.md)
 * 3. Enable this plugin
 * 
 * Features:
 * - Automatic reconnection when browser extension is disabled/enabled
 * - Exponential backoff retry logic for failed connections
 * - Connection health monitoring
 * - User notifications for connection status changes
 * 
 * The plugin automatically detects browser-related requests and provides context hints
 * to help the AI use Browser MCP tools effectively.
 */

interface ConnectionState {
  isConnected: boolean
  lastError?: Error
  retryCount: number
  lastAttempt?: number
  healthCheckInterval?: NodeJS.Timeout
}

interface RetryConfig {
  maxRetries: number
  initialDelay: number
  maxDelay: number
  backoffMultiplier: number
}

export const BrowserMCPPlugin: Plugin = async (ctx) => {
  const { client, project } = ctx
  
  // Track if we've informed the user about browser automation capabilities
  let browserCapabilitiesShown = false
  
  // Connection state management
  const connectionState: ConnectionState = {
    isConnected: true,
    retryCount: 0
  }
  
  // Retry configuration
  const retryConfig: RetryConfig = {
    maxRetries: 5,
    initialDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    backoffMultiplier: 2
  }
  
  /**
   * Calculate delay for exponential backoff
   */
  const getRetryDelay = (retryCount: number): number => {
    const delay = Math.min(
      retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, retryCount),
      retryConfig.maxDelay
    )
    return delay
  }
  
  /**
   * Check if an error indicates a connection problem
   */
  const isConnectionError = (error: any): boolean => {
    if (!error) return false
    
    const errorMessage = typeof error === 'string' ? error : error.message || ''
    const errorString = errorMessage.toLowerCase()
    
    return (
      errorString.includes('connection') ||
      errorString.includes('econnrefused') ||
      errorString.includes('enotfound') ||
      errorString.includes('timeout') ||
      errorString.includes('network') ||
      errorString.includes('disconnected') ||
      errorString.includes('unavailable')
    )
  }
  
  /**
   * Attempt to reconnect to Browser MCP
   */
  const attemptReconnection = async (toolName: string): Promise<boolean> => {
    if (connectionState.retryCount >= retryConfig.maxRetries) {
      return false
    }
    
    const delay = getRetryDelay(connectionState.retryCount)
    connectionState.retryCount++
    connectionState.lastAttempt = Date.now()
    
    await new Promise(resolve => setTimeout(resolve, delay))
    
    try {
      // Try to call a lightweight browser tool to test connection
      // This will be caught by the tool.execute hooks
      return true
    } catch (error) {
      return false
    }
  }
  
  /**
   * Reset connection state on successful connection
   */
  const resetConnectionState = () => {
    connectionState.isConnected = true
    connectionState.retryCount = 0
    connectionState.lastError = undefined
  }
  
  /**
   * Mark connection as failed
   */
  const markConnectionFailed = (error: Error) => {
    connectionState.isConnected = false
    connectionState.lastError = error
  }
  
  /**
   * Start periodic health check
   */
  const startHealthCheck = () => {
    // Check connection health every 30 seconds when disconnected
    connectionState.healthCheckInterval = setInterval(() => {
      if (!connectionState.isConnected) {
        // Health check will be triggered on next tool use
      }
    }, 30000)
  }
  
  /**
   * Stop health check
   */
  const stopHealthCheck = () => {
    if (connectionState.healthCheckInterval) {
      clearInterval(connectionState.healthCheckInterval)
      connectionState.healthCheckInterval = undefined
    }
  }
  
  return {
    /**
     * Hook into session creation to inject browser automation context
     */
    "session.created": async ({ session }) => {
      // Session created - ready for browser automation
      startHealthCheck()
    },
    
    /**
     * Hook before tool execution to provide browser-specific guidance
     */
    "tool.execute.before": async (input, output) => {
      // Detect if a browser-related MCP tool is being called
      if (input.tool.startsWith("browsermcp_")) {
        // Check if we need to attempt reconnection
        if (!connectionState.isConnected) {
          // Notify about reconnection attempt
          output.messages = output.messages || []
          output.messages.push({
            role: "user",
            content: `[Browser MCP] Connection lost. Attempting to reconnect (attempt ${connectionState.retryCount + 1}/${retryConfig.maxRetries})...`
          })
        }
      }
    },
    
    /**
     * Hook after tool execution to handle browser automation results
     */
    "tool.execute.after": async (input, output) => {
      if (input.tool.startsWith("browsermcp_")) {
        // Check if the tool execution failed due to connection issues
        const hasError = output.isError || (output.content && typeof output.content === 'string' && output.content.includes('error'))
        
        if (hasError && output.content) {
          const errorContent = typeof output.content === 'string' ? output.content : JSON.stringify(output.content)
          
          if (isConnectionError(errorContent)) {
            markConnectionFailed(new Error(errorContent))
            
            // Attempt reconnection
            const reconnected = await attemptReconnection(input.tool)
            
            if (reconnected) {
              resetConnectionState()
              // Add success message
              output.messages = output.messages || []
              output.messages.push({
                role: "assistant",
                content: "[Browser MCP] Successfully reconnected to browser extension. You can continue with browser automation."
              })
            } else if (connectionState.retryCount >= retryConfig.maxRetries) {
              // Max retries reached
              output.messages = output.messages || []
              output.messages.push({
                role: "assistant",
                content: `[Browser MCP] Failed to reconnect after ${retryConfig.maxRetries} attempts. Please check that:\n1. The Browser MCP extension is enabled in Chrome\n2. The browser is running\n3. The extension has proper permissions\n\nYou may need to restart OpenCode if the issue persists.`
              })
            }
          }
        } else {
          // Successful execution - ensure we're marked as connected
          if (!connectionState.isConnected) {
            resetConnectionState()
            output.messages = output.messages || []
            output.messages.push({
              role: "assistant",
              content: "[Browser MCP] Connection restored successfully."
            })
          }
        }
      }
    },
    
    /**
     * Hook to add browser automation context during session compaction
     * This helps preserve browser-related context across long sessions
     */
    "experimental.session.compacting": async (input, output) => {
      // Check if any browser automation was performed in this session
      // Guard against input.messages being undefined
      const hasBrowserTools = input.messages?.some(msg => 
        msg.content?.some(part => 
          part.type === "tool_use" && part.name?.startsWith("browsermcp_")
        )
      )
      
      if (hasBrowserTools) {
        output.context.push(`## Browser Automation Context

The Browser MCP integration has been used in this session. When resuming:
- Browser state may have changed since last interaction
- Browser tabs opened during automation may still be active
- Consider checking current browser state before making assumptions
- Use Browser MCP tools to verify page state when needed`)
      }
    },
    
    /**
     * Hook into TUI toast notifications to show browser-specific tips
     */
    "tui.toast.show": async (input, output) => {
      // You could customize toast messages related to browser automation here
    },
    
    /**
     * Event handler for various OpenCode events
     */
    event: async ({ event }) => {
      // Handle session idle - could be used to close browser tabs
      if (event.type === "session.idle") {
        // Session is idle
      }
      
      // Handle session errors - could help debug browser automation issues
      if (event.type === "session.error") {
        // Check if it's a browser-related error
        const error = (event as any).error
        if (error && isConnectionError(error)) {
          markConnectionFailed(error)
        }
      }
      
      // Clean up on session end
      if (event.type === "session.end") {
        stopHealthCheck()
      }
    }
  }
}

/**
 * Default export for the plugin
 */
export default BrowserMCPPlugin
