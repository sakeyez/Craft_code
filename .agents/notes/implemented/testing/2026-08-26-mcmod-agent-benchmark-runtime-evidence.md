# Agent Note: Benchmark runtime evidence and cost accounting

Status: implemented

English | [中文](2026-08-26-mcmod-agent-benchmark-runtime-evidence.zh.md)

## Problem

The Minecraft benchmark previously read sessions from the workspace instead of the agent's `DSH_HOME`, so tool, timing, retry, and token metrics were reported as zero or unavailable. Static checks also treated source text as the only gameplay evidence and labeled all cost as USD.

## Decision

The benchmark reads every Zstandard session frame from the run-owned `DSH_HOME`, records capture status and event count, and keeps a redacted decompressed transcript artifact. Each run injects a benchmark-owned server GameTest after the agent exits, builds the modified workspace independently, and runs `runGameTestServer`. A failed runtime test fails the run; missing runtime infrastructure produces `inconclusive`.

Token reports keep input, output, cache-read, cache-write, and reasoning fields separate. A price table declares provider, model, currency, and per-million-token rates. An optional actual paid amount is reconciled separately from the calculated estimate.

## Alternatives considered

**Agent-authored tests:** rejected because the evaluated agent could omit or weaken them.

**Client GUI smoke tests:** rejected because the reproducible benchmark requires a headless server signal and does not need a graphical environment.

**One ambiguous total-token or USD field:** rejected because cache accounting and the user's DeepSeek currency are not interchangeable.

## Consequences

Reports distinguish static, build, runtime, session-capture, and cost evidence. Runtime GameTests currently provide deterministic server registry smoke coverage; behavior not exercised by those tests remains explicitly unverified. Existing price files using the legacy `cache` key remain readable, while new reports use `cacheRead` and `cacheWrite`.
