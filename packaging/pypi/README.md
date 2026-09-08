# klaridian

Generate [Model Context Protocol](https://modelcontextprotocol.io) servers from an OpenAPI spec, with observability plugins and tool curation built in.

```bash
pip install klaridian        # or: uv tool install klaridian / pipx install klaridian
klaridian generate --spec ./openapi.json --out ./my-server --language python
```

This PyPI package ships a **prebuilt native binary** — no Node.js, no virtualenv, nothing to compile. It's the same CLI published to npm as `klaridian`, compiled to a standalone executable and distributed as a platform-specific wheel (the pattern [ruff](https://pypi.org/project/ruff/) and [uv](https://pypi.org/project/uv/) use).

- **Docs:** https://klaridian.dev
- **Source:** https://github.com/klaridian/klaridian
- **License:** MIT
