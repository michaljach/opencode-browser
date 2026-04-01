# OpenCode Browser MCP Plugin - Architecture

This document describes the architecture and data flow of the OpenCode Browser MCP Plugin.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User / Developer                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Natural Language Prompts
                             │ (e.g., "Navigate to github.com")
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                         OpenCode TUI                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  • Chat Interface                                        │  │
│  │  • Command Processing (/init, /undo, etc.)              │  │
│  │  • Session Management                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Tool Invocation
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenCode Agent / LLM                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  • Interprets user intent                                │  │
│  │  • Selects appropriate tools                             │  │
│  │  • Generates tool parameters                             │  │
│  │  • Processes tool results                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
┌───────────────────────────┐  ┌──────────────────────────┐
│   Built-in Tools          │  │   MCP Tools              │
│  • read                   │  │  • browsermcp_navigate   │
│  • write                  │  │  • browsermcp_click      │
│  • bash                   │  │  • browsermcp_fill       │
│  • grep                   │  │  • browsermcp_extract    │
│  • glob                   │  │  • browsermcp_screenshot │
└───────────────────────────┘  └──────────┬───────────────┘
                                          │
                             ┌────────────┘
                             │
                             │ Plugin Hooks Intercept
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Browser MCP Plugin (index.ts)                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Hook: tool.execute.before                               │  │
│  │  • Logs browser tool invocation                          │  │
│  │  • Validates parameters                                  │  │
│  │  • Can modify tool arguments                             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Hook: tool.execute.after                                │  │
│  │  • Logs browser tool results                             │  │
│  │  • Can process/transform results                         │  │
│  │  • Triggers custom actions                               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Hook: experimental.session.compacting                   │  │
│  │  • Preserves browser state context                       │  │
│  │  • Injects continuation prompts                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Hook: session.created, event                            │  │
│  │  • Session lifecycle management                          │  │
│  │  • Event-driven actions                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ MCP Protocol
                             │ (stdio/JSON-RPC)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Browser MCP Server Process                          │
│               (npx @browsermcp/mcp@0.1.3)                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  • Receives tool invocations via stdin                   │  │
│  │  • Translates to browser automation commands             │  │
│  │  • Communicates with browser extension                   │  │
│  │  • Returns results via stdout                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ WebSocket / Native Messaging
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│            Browser MCP Extension (Chrome/Edge)                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  • Receives commands from MCP server                     │  │
│  │  • Executes browser automation via Chrome APIs           │  │
│  │  • Captures screenshots, extracts data                   │  │
│  │  • Returns results to MCP server                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Chrome DevTools Protocol
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Chrome/Edge Browser                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  • Actual web pages and DOM                              │  │
│  │  • JavaScript execution                                  │  │
│  │  • User interactions (clicks, typing, etc.)              │  │
│  │  • Network requests                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### 1. OpenCode TUI
**Responsibility**: User interface and session management
- Handles user input
- Manages conversation history
- Displays agent responses
- Executes commands (/init, /undo, etc.)

### 2. OpenCode Agent / LLM
**Responsibility**: Intent interpretation and tool orchestration
- Understands natural language prompts
- Decides which tools to use
- Generates tool parameters
- Processes and presents results to user

### 3. Browser MCP Plugin
**Responsibility**: Browser automation enhancement and monitoring
- Hooks into tool execution lifecycle
- Logs browser automation activities
- Preserves browser context across sessions
- Enables custom post-processing

**Key Hooks**:
- `tool.execute.before`: Pre-process tool calls
- `tool.execute.after`: Post-process results
- `experimental.session.compacting`: Context preservation
- `session.created`: Session initialization
- `event`: Event handling

### 4. Browser MCP Server
**Responsibility**: Protocol translation
- Implements MCP protocol (stdio JSON-RPC)
- Translates tool calls to browser commands
- Manages communication with browser extension
- Handles errors and timeouts

### 5. Browser MCP Extension
**Responsibility**: Browser control
- Executes automation commands
- Uses Chrome DevTools Protocol
- Captures screenshots
- Extracts page data
- Handles DOM interactions

### 6. Chrome/Edge Browser
**Responsibility**: Web page rendering and execution
- Renders web pages
- Executes JavaScript
- Handles user interactions
- Manages network requests

## Data Flow Examples

### Example 1: Simple Navigation

```
User Prompt: "Go to github.com"
    ↓
OpenCode TUI receives input
    ↓
LLM interprets → decides to use "browsermcp_navigate"
    ↓
Plugin Hook (tool.execute.before)
    • Logs: "Executing browser tool: browsermcp_navigate"
    • Logs: "Tool arguments: { url: 'https://github.com' }"
    ↓
Browser MCP Server receives:
    {
      "tool": "browsermcp_navigate",
      "args": { "url": "https://github.com" }
    }
    ↓
Browser Extension executes:
    chrome.tabs.update({ url: "https://github.com" })
    ↓
Browser navigates to GitHub
    ↓
Extension returns: { "success": true, "url": "https://github.com" }
    ↓
MCP Server returns result to OpenCode
    ↓
Plugin Hook (tool.execute.after)
    • Logs: "Completed browser tool: browsermcp_navigate"
    ↓
LLM receives result → formats response
    ↓
User sees: "✓ Navigated to github.com"
```

### Example 2: Form Filling with Extraction

```
User Prompt: "Fill out the contact form at example.com with my details"
    ↓
LLM generates multiple tool calls:
    1. browsermcp_navigate (to example.com)
    2. browsermcp_fill (for each form field)
    3. browsermcp_click (submit button)
    4. browsermcp_extract (success message)
    ↓
Each tool call flows through:
    Plugin Hooks → MCP Server → Extension → Browser
    ↓
Results flow back:
    Browser → Extension → MCP Server → Plugin Hooks → LLM
    ↓
User sees complete result with all steps logged
```

### Example 3: Session Compaction

```
Long session with multiple browser interactions
    ↓
OpenCode detects session needs compaction
    ↓
Plugin Hook (experimental.session.compacting)
    • Detects browser tools were used
    • Injects context: "Browser state may have changed..."
    • Adds continuation instructions
    ↓
Compaction summary includes browser context
    ↓
New session continues with preserved browser state awareness
```

## Plugin Hook Execution Order

```
1. session.created (when session starts)
    ↓
2. tool.execute.before (before each tool)
    ↓
3. [Tool executes - MCP Server → Extension → Browser]
    ↓
4. tool.execute.after (after each tool)
    ↓
5. event (various events throughout session)
    ↓
6. experimental.session.compacting (when session compacts)
```

## Configuration Flow

```
opencode.json
    ↓
OpenCode loads configuration
    ↓
Parses MCP server configuration:
    {
      "browsermcp": {
        "command": ["npx", "-y", "@browsermcp/mcp@0.1.3"]
      }
    }
    ↓
Spawns MCP server process
    ↓
Server connects to browser extension
    ↓
Plugin loads and initializes hooks
    ↓
Tools become available to LLM
```

## Error Handling Flow

```
Error occurs in browser
    ↓
Extension catches error
    ↓
Returns error to MCP Server
    ↓
MCP Server formats error
    ↓
Plugin Hook (tool.execute.after) sees error
    • Can log for debugging
    • Can transform error message
    ↓
LLM receives error
    ↓
LLM decides next action:
    • Retry with different parameters
    • Try alternative approach
    • Report error to user
```

## Security Considerations

```
User Prompt
    ↓
OpenCode Agent
    ↓
Security Boundaries:
    1. Plugin can validate/sanitize tool parameters
    2. MCP Server validates commands
    3. Browser extension has limited permissions
    4. Browser security sandbox protects system
```

## Extension Points

The plugin provides several extension points:

1. **Custom Tools**: Add new browser automation tools
2. **Tool Hooks**: Intercept and modify tool execution
3. **Event Handlers**: React to OpenCode events
4. **Context Injection**: Add custom context during compaction
5. **Post-Processing**: Transform tool results

## Performance Considerations

```
Latency Breakdown:
    User Input → LLM: ~100-500ms (depends on model)
    LLM → Tool Decision: ~500-2000ms (depends on complexity)
    Plugin Hook (before): ~1-5ms
    Tool → MCP Server: ~10-50ms
    MCP Server → Extension: ~20-100ms
    Extension → Browser: ~50-500ms (depends on action)
    Browser → Extension: ~50-500ms
    Extension → MCP Server: ~20-100ms
    MCP Server → Tool Result: ~10-50ms
    Plugin Hook (after): ~1-5ms
    LLM Processing Result: ~100-500ms
    
Total: ~1-3 seconds for simple actions
```

## Monitoring and Debugging

The plugin provides several debugging capabilities:

```
Console Logs:
    • Plugin initialization
    • Tool execution (before/after)
    • Session events
    • Error conditions

OpenCode Logs:
    • MCP server startup
    • Tool invocations
    • Tool results
    • Session management

Browser Extension Logs:
    • Command execution
    • DOM interactions
    • Screenshots
    • Errors
```

## Future Architecture Enhancements

1. **Caching Layer**: Cache browser state for faster operations
2. **Connection Pool**: Multiple browser instances
3. **Proxy Support**: Route traffic through proxies
4. **Custom Commands**: Domain-specific automation commands
5. **Visual Regression**: Screenshot comparison tools
6. **Performance Metrics**: Track automation performance
7. **Multi-Browser**: Support Firefox, Safari, etc.

---

This architecture enables powerful browser automation while maintaining separation of concerns and extensibility.
