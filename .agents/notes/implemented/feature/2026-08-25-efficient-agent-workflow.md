# Agent Note: Efficient default workflow for coding tasks

Status: implemented

English | [中文](2026-08-25-efficient-agent-workflow.zh.md)

## Problem

The default coding personas did not give the model a compact decision process for scoping work, choosing evidence for API questions, batching file operations, or ranking runtime risks. The same omission encouraged fragmented research and repeated tool activity in otherwise local code changes.

## Decision

The generic `standard`, `code`, `cordis`, `minimal`, and `mcmod` CLI presets opt into one shared `CODING_WORKFLOW_POLICY` exported by `dsh-system-prompt` and applied by `dsh-persona`. Before broad exploration or edits, the model states a short scope containing the goal, required behavior, exclusions, likely files, acceptance checks, and non-blocking uncertainties. It starts API research with repository patterns, types, compiler feedback, and tests; deeper documentation or runtime inspection is tied to a concrete unresolved decision or a high-risk behavior, and stops when that decision is supported. It forms a key file set, batches independent reads, avoids rereading unchanged files, and groups edits before running focused checks. Standalone prompts retain their explicit text and environment override semantics.

The policy ranks runtime investigation by probability, impact, trigger path, existing protection, and verification cost. Security, data, concurrency, process, and lifecycle risks remain first-class concerns. Low-probability, low-impact concerns without a trigger path are recorded as residual risk instead of delaying delivery. A user request for a deep audit explicitly overrides the default triage. Progress updates report confirmed facts, material uncertainty, the reason for the next query, and the point at which exploration ends; they do not expose hidden reasoning or narrate every tool call.

This is prompt guidance, not an execution quota or a runtime veto. The existing tool protocol, compiler, tests, and model remain able to request additional evidence when the task requires it.

## Alternatives considered

**Change `agent-loop` or the tool scheduler.** Rejected because these layers execute calls after the model chooses them and do not own research depth, scope definition, or progress prose. Changing them would add policy to a shared lifecycle mechanism without a deterministic signal for the behavior at issue.

**Add a hard tool-call or read-count limit.** Rejected because necessary investigation, user-requested audits, and protection of overlapping user edits can require additional calls. A quota would trade the reported inefficiency for correctness failures.

**Create a second planning protocol.** Rejected because existing plan mode owns explicit plan approval and durable plan state. The new text improves ordinary implementation turns and does not compete with that protocol.

**Add framework-specific rules.** Rejected because the failure is a general coding workflow problem. The policy names evidence classes and risk categories, not Minecraft or another framework.

## Consequences

Generic model requests receive a stable, cacheable workflow policy across the shipped coding compositions and standalone examples. Prompt length increases modestly, while the model has explicit stopping conditions for API research, rereads, and low-value runtime investigation. The behavior remains probabilistic: the model can still ignore prose, and the policy cannot prove that two reads were unnecessary. Deterministic configuration tests and prompt snapshots verify that every generic entry point carries the same obligations and no Minecraft-specific text.

## Testing

`apps/cli/tests/agent-efficiency-prompt.spec.ts` parses the shipped presets with the Loader YAML schema and checks the shared strategy markers, explicit enablement, standalone default personas, preserved JSON-RPC environment overrides, and absence of Minecraft-specific guidance. `dsh-loader-smoke` now returns measured wall time and folds existing JSONL replay records into tool, duplicate-read, skill, retry, token, validation-event, and transcript-digest metrics without adding wire events. The affected prompt snapshots were checked through the existing keyless ACP replay mechanism. Windows bash and symlink restrictions remain environment limitations, so no model-level speed claim is made without repeated clean-HEAD runs.
