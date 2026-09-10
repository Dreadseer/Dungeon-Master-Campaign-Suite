# tools/

Developer scratch. Nothing here is part of the DMCS application, imported by it, or run by any
npm script.

## `dmcs-agent.mjs`

A standalone CLI experiment that points the Anthropic SDK at a local **LM Studio** server
(`baseURL: http://localhost:1234`, `Llama-3.2-1B-Instruct-GGUF`). It is **not** part of the DMCS AI
architecture, which is Anthropic Claude online and Ollama offline — see `electron/services/` — and
nothing in the app calls it.

Kept rather than deleted because it is a working reference for driving a local OpenAI-compatible
endpoint through the Anthropic SDK. Moved here from `agent/` in Phase 0 so it stops looking like
production code. Delete it freely if it stops being useful.
