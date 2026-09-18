// packages/cli/src/emit/emit-test-client.ts
//
// MCPFO-102: emits a self-contained HTML MCP test client for a generated
// streamable-http server. The generated server serves this at `GET /` (MCP
// itself stays on `/mcp`), giving anyone who opens the server in a browser an
// instant, zero-install way to inspect and call the tools it exposes.
//
// The client is intentionally language- AND architecture-agnostic: it speaks
// MCP-over-HTTP (JSON-RPC POST to the same origin's `/mcp`) — `initialize`,
// then `tools/list`, then `tools/call` on a selected tool with a JSON-args
// textarea — and simply renders whatever the running server advertises. It
// therefore works identically for a TypeScript or Python server, and for the
// per-tool ("tools") or code-mode architecture, because it only ever asks the
// live server what it can do.
//
// It ships as READABLE VENDORED SOURCE (PLAN.md §7): no external CDN, no npm
// dependency, no build step. The whole thing is inline HTML + vanilla JS a
// reader can audit. To keep the emitter source itself readable, the client's
// JavaScript avoids template literals and backticks entirely (plain string
// concatenation), so nothing here needs escaping when embedded in the
// generated `src/test-client.ts` template literal.

/**
 * Returns the full HTML document (with inline CSS + JS, no external requests)
 * for the built-in streamable-http test client. Served verbatim by the
 * generated server at `GET /`.
 */
export function emitTestClientHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MCP test client</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    max-width: 900px; margin-inline: auto;
  }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  .sub { color: #888; margin: 0 0 1.5rem; }
  .row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin-bottom: 1rem; }
  button {
    font: inherit; padding: .4rem .9rem; border-radius: 6px; cursor: pointer;
    border: 1px solid #8884; background: #8882;
  }
  button:hover { background: #8883; }
  button:disabled { opacity: .5; cursor: default; }
  code, pre, textarea, select { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  select { font: inherit; padding: .3rem .5rem; border-radius: 6px; }
  textarea {
    width: 100%; min-height: 120px; padding: .6rem; border-radius: 6px;
    border: 1px solid #8884; background: #8881; resize: vertical; font-size: 13px;
  }
  pre {
    white-space: pre-wrap; word-break: break-word; padding: .8rem;
    border-radius: 6px; border: 1px solid #8884; background: #8881;
    font-size: 13px; max-height: 420px; overflow: auto;
  }
  .tool { border: 1px solid #8884; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
  .tool h3 { margin: 0 0 .25rem; font-size: 1rem; }
  .tool .desc { color: #888; margin: 0 0 .75rem; font-size: 13px; }
  .muted { color: #888; }
  label { font-size: 13px; font-weight: 600; display: block; margin-bottom: .3rem; }
  .err { color: #c0392b; }
</style>
</head>
<body>
<h1>MCP test client</h1>
<p class="sub">A built-in, zero-install client for this MCP server. It speaks MCP over HTTP to <code>/mcp</code> on this same origin.</p>

<div class="row">
  <button id="load">Connect &amp; list tools</button>
  <span id="status" class="muted"></span>
</div>

<div id="tools"></div>

<script>
"use strict";

// The MCP endpoint is served on the same origin as this page, at /mcp.
var MCP_URL = new URL("/mcp", window.location.href).toString();
var rpcId = 0;

// One JSON-RPC round-trip to the streamable-http MCP endpoint. The server may
// answer with a plain JSON body OR a Server-Sent-Events frame
// (event: message\\ndata: {...}); the Accept header below asks for both, so we
// parse whichever comes back.
function mcpCall(method, params) {
  rpcId += 1;
  var body = JSON.stringify({ jsonrpc: "2.0", id: rpcId, method: method, params: params || {} });
  return fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The MCP streamable-http handler REQUIRES both media types here.
      "Accept": "application/json, text/event-stream"
    },
    body: body
  }).then(function (res) {
    return res.text().then(function (text) {
      var parsed = parseRpcBody(text);
      if (!res.ok && !parsed) {
        throw new Error("HTTP " + res.status + ": " + text.slice(0, 300));
      }
      if (!parsed) throw new Error("Could not parse a JSON-RPC response from: " + text.slice(0, 300));
      if (parsed.error) {
        throw new Error("JSON-RPC error " + parsed.error.code + ": " + parsed.error.message);
      }
      return parsed.result;
    });
  });
}

// Accept either a raw JSON body or an SSE stream; pull the first JSON object
// out of any "data:" line (or the whole body if it's already JSON).
function parseRpcBody(text) {
  var trimmed = (text || "").trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch (e) { /* fall through to SSE parsing */ }
  var lines = trimmed.split("\\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^data:\\s*/, "").trim();
    if (line.charAt(0) === "{") {
      try { return JSON.parse(line); } catch (e2) { /* keep looking */ }
    }
  }
  return null;
}

function setStatus(msg, isError) {
  var el = document.getElementById("status");
  el.textContent = msg;
  el.className = isError ? "err" : "muted";
}

function el(tag, props, children) {
  var node = document.createElement(tag);
  if (props) Object.keys(props).forEach(function (k) {
    if (k === "class") node.className = props[k];
    else if (k === "text") node.textContent = props[k];
    else node.setAttribute(k, props[k]);
  });
  (children || []).forEach(function (c) { node.appendChild(c); });
  return node;
}

// Render one tool with an editable JSON-args textarea and a Call button.
function renderTool(tool) {
  var card = el("div", { class: "tool" });
  card.appendChild(el("h3", { text: tool.name }));
  if (tool.description) card.appendChild(el("p", { class: "desc", text: tool.description }));

  var schemaBox = el("pre", { text: JSON.stringify(tool.inputSchema || {}, null, 2) });
  card.appendChild(el("label", { text: "Input schema" }));
  card.appendChild(schemaBox);

  var argsLabel = el("label", { text: "Arguments (JSON)" });
  var args = el("textarea");
  args.value = exampleArgs(tool.inputSchema);
  card.appendChild(argsLabel);
  card.appendChild(args);

  var callBtn = el("button", { text: "Call " + tool.name });
  var out = el("pre", { class: "muted", text: "(no result yet)" });
  callBtn.addEventListener("click", function () {
    var parsedArgs;
    try {
      parsedArgs = args.value.trim() ? JSON.parse(args.value) : {};
    } catch (e) {
      out.className = "err";
      out.textContent = "Invalid JSON in arguments: " + e.message;
      return;
    }
    callBtn.disabled = true;
    out.className = "muted";
    out.textContent = "Calling...";
    mcpCall("tools/call", { name: tool.name, arguments: parsedArgs }).then(function (result) {
      out.className = result && result.isError ? "err" : "";
      out.textContent = JSON.stringify(result, null, 2);
    }).catch(function (err) {
      out.className = "err";
      out.textContent = String(err && err.message ? err.message : err);
    }).then(function () { callBtn.disabled = false; });
  });

  card.appendChild(el("div", { class: "row" }, [callBtn]));
  card.appendChild(out);
  return card;
}

// Build a minimal skeleton of arguments from a JSON schema's required props,
// so the textarea starts with a helpful stub instead of an empty object.
function exampleArgs(schema) {
  if (!schema || schema.type !== "object" || !schema.properties) return "{}";
  var required = schema.required || [];
  var obj = {};
  required.forEach(function (key) {
    var prop = schema.properties[key] || {};
    obj[key] = stubForType(prop.type);
  });
  return JSON.stringify(obj, null, 2);
}

function stubForType(type) {
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "array") return [];
  if (type === "object") return {};
  return "";
}

function loadTools() {
  var container = document.getElementById("tools");
  container.innerHTML = "";
  setStatus("Connecting...");
  // initialize first (the MCP handshake), then list tools. The server is
  // stateless, so each request stands alone — no session header to carry.
  mcpCall("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "klaridian-test-client", version: "1.0.0" }
  }).then(function () {
    return mcpCall("tools/list", {});
  }).then(function (result) {
    var tools = (result && result.tools) || [];
    setStatus(tools.length + " tool" + (tools.length === 1 ? "" : "s") + " available");
    if (!tools.length) {
      container.appendChild(el("p", { class: "muted", text: "This server exposes no tools." }));
      return;
    }
    tools.forEach(function (t) { container.appendChild(renderTool(t)); });
  }).catch(function (err) {
    setStatus(String(err && err.message ? err.message : err), true);
  });
}

document.getElementById("load").addEventListener("click", loadTools);
// Auto-connect on first load for convenience.
loadTools();
</script>
</body>
</html>
`;
}
