import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
  type ToolResultBlock,
} from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')

const MOD_ITEMS = `package com.example.minimal;

import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public final class ModItems {
  public static final Item CODEX_GEAR = Registry.register(
    Registries.ITEM,
    Identifier.of(MinimalMod.MOD_ID, "codex_gear"),
    new Item(new Item.Settings())
  );

  private ModItems() {
  }

  public static void register() {
  }
}
`

const LANG = `${JSON.stringify({ 'item.minimalmod.codex_gear': 'Codex Gear' }, null, 2)}
`

const MODEL = `${JSON.stringify({
  parent: 'minecraft:item/generated',
  textures: { layer0: 'minimalmod:item/codex_gear' },
}, null, 2)}
`

const NEO_MOD_ITEMS = `package com.example.minimal;

import net.minecraft.world.item.Item;
import net.minecraft.world.item.Items;
import net.neoforged.neoforge.registries.DeferredRegister;
import net.neoforged.neoforge.registries.DeferredHolder;

public final class ModItems {
  public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems("minimalneo");
  public static final DeferredHolder<Item, Item> CODEX_GEAR = ITEMS.registerSimpleItem("codex_gear");

  private ModItems() {
  }
}
`

const NEO_LANG = `${JSON.stringify({ 'item.minimalneo.codex_gear': 'Codex Gear' }, null, 2)}
`

const NEO_MODEL = `${JSON.stringify({
  parent: 'minecraft:item/generated',
  textures: { layer0: 'minimalneo:item/codex_gear' },
}, null, 2)}
`

interface ToolCallStep {
  readonly name: string
  readonly args: Record<string, unknown>
}

const STEPS: readonly ToolCallStep[] = [
  {
    name: 'write',
    args: {
      file_path: 'src/main/java/com/example/minimal/ModItems.java',
      content: MOD_ITEMS,
    },
  },
  {
    name: 'write',
    args: {
      file_path: 'src/main/resources/assets/minimalmod/lang/en_us.json',
      content: LANG,
    },
  },
  {
    name: 'write',
    args: {
      file_path: 'src/main/resources/assets/minimalmod/models/item/codex_gear.json',
      content: MODEL,
    },
  },
  { name: 'detect_mc_project', args: {} },
  { name: 'validate_mc_resources', args: {} },
  { name: 'run_mc_check', args: { target: 'build' } },
]

const NEO_STEPS: readonly ToolCallStep[] = [
  {
    name: 'write',
    args: {
      file_path: 'src/main/java/com/example/minimal/ModItems.java',
      content: NEO_MOD_ITEMS,
    },
  },
  {
    name: 'write',
    args: {
      file_path: 'src/main/resources/assets/minimalneo/lang/en_us.json',
      content: NEO_LANG,
    },
  },
  {
    name: 'write',
    args: {
      file_path: 'src/main/resources/assets/minimalneo/models/item/codex_gear.json',
      content: NEO_MODEL,
    },
  },
  { name: 'detect_mc_project', args: {} },
  { name: 'validate_mc_resources', args: {} },
  { name: 'run_mc_check', args: { target: 'datagen' } },
]

function toolResultCount(options: GenerateOptions): number {
  return options.messages.flatMap(message => message.content)
    .filter((block): block is ToolResultBlock => block.type === 'tool-result')
    .length
}

function hasTool(options: GenerateOptions, name: string): boolean {
  return options.tools?.some(tool => tool.name === name) === true
}

function isNeoForgeTask(options: GenerateOptions): boolean {
  return options.messages.some(message => message.content.some((block) => {
    if (block.type !== 'text') return false
    return block.text.toLowerCase().includes('neoforge')
  }))
}

async function * textResponse(text: string): AsyncIterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

async function * toolCallResponse(index: number, step: ToolCallStep): AsyncIterable<StreamChunk> {
  const id = CallId(`mcmod-scripted-${index}`)
  const args = JSON.stringify(step.args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name: step.name, argumentsDelta: args }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: step.name, arguments: args } }
  yield { type: 'usage', usage: { inputTokens: 13, outputTokens: 4 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/** Deterministic mcmod wiring adapter: edits text resources, then runs Minecraft tools. */
class McmodScriptedAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [{ id: OFF, name: 'Off' }],
        defaultEffort: OFF,
      },
    }
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!hasTool(options, 'detect_mc_project')) return textResponse('mcmod fixture')
    const index = toolResultCount(options)
    const steps = isNeoForgeTask(options) ? NEO_STEPS : STEPS
    const step = steps[index]
    if (step === undefined) return textResponse('MCMOD_E2E_OK')
    return toolCallResponse(index, step)
  }
}

export const name = 'mcmod-scripted-llm'
export const inject = ['llm']

/** Register the keyless `mcmod-scripted` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['mcmod-scripted'], new McmodScriptedAdapter())
}
