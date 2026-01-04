# Quick Start Guide

Get up and running with the OpenCode Browser MCP Plugin in 5 minutes.

## Prerequisites

- OpenCode installed (`npm install -g opencode-ai`)
- Node.js v18+ installed
- Chrome or Edge browser

## Step 1: Install Browser MCP Extension (2 minutes)

1. Visit https://browsermcp.io/install
2. Click "Install Extension"
3. Add the extension to your browser
4. Pin the extension to your browser toolbar

## Step 2: Configure OpenCode (1 minute)

Create or edit your `opencode.json` file in your project directory:

```bash
cat > opencode.json << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-browser"],
  "mcp": {
    "browsermcp": {
      "type": "local",
      "command": ["npx", "-y", "@browsermcp/mcp@latest"],
      "enabled": true
    }
  }
}
EOF
```

**What this does:**
- `"plugin": ["opencode-browser"]` - Installs the plugin from npm (automatic)
- `"mcp": { "browsermcp": ... }` - Configures Browser MCP server (required for browser control)

Both are needed! The plugin enhances the MCP tools, but the MCP server does the actual browser automation.

### Alternative: Local Installation (for development)

If you're testing local changes to the plugin:

```bash
# Project-specific
mkdir -p .opencode/plugin
cp index.ts .opencode/plugin/browser-mcp.ts

# Or global
mkdir -p ~/.config/opencode/plugin
cp index.ts ~/.config/opencode/plugin/browser-mcp.ts
```

## Step 3: Test It Out (1 minute)

1. Start OpenCode in your project:
```bash
opencode
```

2. Try a simple browser automation command:
```
Navigate to https://github.com and tell me what the featured repository is
```

3. Watch as OpenCode opens your browser and completes the task!

## Verification Checklist

- [ ] Browser MCP extension is installed and visible in browser toolbar
- [ ] `opencode.json` contains the MCP configuration
- [ ] Plugin file is in the correct directory
- [ ] OpenCode starts without errors
- [ ] Browser automation commands work

## Troubleshooting Quick Fixes

### "MCP server not found"
```bash
# Test if npx can run the MCP server
npx -y @browsermcp/mcp@latest --version
```

### "Plugin not loaded"
```bash
# Check if plugin file exists
ls -la .opencode/plugin/browser-mcp.ts
# or for global
ls -la ~/.config/opencode/plugin/browser-mcp.ts
```

### "Browser doesn't respond"
1. Check if Browser MCP extension is enabled
2. Try clicking the extension icon and selecting "Reconnect"
3. Restart your browser

## Next Steps

Now that you're set up, try these examples:

1. **Web Search**: `Search Google for "OpenCode AI" and summarize the top result`

2. **Form Filling**: `Go to https://example.com and fill out the contact form with test data`

3. **Web Scraping**: `Visit Hacker News and list the top 5 stories`

4. **Testing**: `Navigate to my app at localhost:3000 and verify the login button exists`

See [EXAMPLES.md](./EXAMPLES.md) for more usage examples.

## Getting Help

- Check the full [README.md](./README.md) for detailed documentation
- Visit [Browser MCP Docs](https://docs.browsermcp.io/)
- Visit [OpenCode Docs](https://opencode.ai/docs/)
- Report issues on GitHub

---

Enjoy automating your browser with OpenCode! 🚀
