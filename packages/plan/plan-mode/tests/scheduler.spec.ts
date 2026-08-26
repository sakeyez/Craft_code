import { describe, expect, it } from 'vitest'
import { PlanGraphError, executePlanTasks } from '../src/scheduler.ts'
import { PlanId, PlanTaskId, type PlanTaskSpec } from '../src/types.ts'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

function task(id: string, dependencies: string[] = [], resources: string[] = []): PlanTaskSpec {
  return {
    id: PlanTaskId(id),
    description: `task ${id}`,
    dependencies: dependencies.map(PlanTaskId),
    concurrency: 'parallel',
    resources,
  }
}

const signal = (): AbortSignal => new AbortController().signal

describe('executePlanTasks', () => {
  it('starts three independent parallel tasks together', async () => {
    const starts: string[] = []
    const gates = new Map(['a', 'b', 'c'].map(id => [id, deferred<number>()]))
    const run = executePlanTasks(PlanId('plan-a'), [task('a'), task('b'), task('c')], async (current) => {
      starts.push(String(current.id))
      return gates.get(String(current.id))!.promise
    }, 3, signal())
    await flush()
    expect(starts).toEqual(['a', 'b', 'c'])
    for (const gate of gates.values()) gate.resolve(1)
    await expect(run).resolves.toMatchObject({ outcome: 'completed' })
  })

  it('waits for dependencies and passes dependency outputs', async () => {
    const starts: string[] = []
    const result = await executePlanTasks(
      PlanId('plan-deps'),
      [task('a'), task('b'), task('c', ['a', 'b'])],
      async (current, context) => {
        starts.push(String(current.id))
        return String(current.id) === 'a'
          ? 'A'
          : String(current.id) === 'b'
            ? 'B'
            : [...context.dependencies.values()].join('')
      },
      2,
      signal(),
    )
    expect(starts).toEqual(['a', 'b', 'c'])
    expect(result.outputs.get(PlanTaskId('c'))).toBe('AB')
  })

  it('honors the batch concurrency limit', async () => {
    const starts: string[] = []
    const first = deferred<undefined>()
    const run = executePlanTasks(
      PlanId('plan-limit'),
      [task('a'), task('b'), task('c')],
      async (current) => {
        starts.push(String(current.id))
        if (starts.length === 2) await first.promise
        return current.id
      },
      2,
      signal(),
    )
    await flush()
    expect(starts).toEqual(['a', 'b'])
    first.resolve(undefined)
    await expect(run).resolves.toMatchObject({ outcome: 'completed' })
    expect(starts).toEqual(['a', 'b', 'c'])
  })

  it('continues unrelated tasks and blocks dependents after a failure', async () => {
    const started: string[] = []
    const result = await executePlanTasks(
      PlanId('plan-failure'),
      [task('failed'), task('dependent', ['failed']), task('unrelated')],
      async (current) => {
        started.push(String(current.id))
        if (current.id === PlanTaskId('failed')) throw new Error('broken')
        return 'ok'
      },
      2,
      signal(),
    )
    expect(started).toEqual(['failed', 'unrelated'])
    expect(result.outcome).toBe('failed')
    expect(result.tasks.map(item => item.status)).toEqual(['failed', 'blocked', 'completed'])
    expect(result.tasks[0]!.error?.message).toBe('broken')
  })

  it('keeps display order independent from completion order and does not repeat tasks', async () => {
    const gates = new Map([['a', deferred<undefined>()], ['b', deferred<undefined>()]])
    const starts: string[] = []
    const run = executePlanTasks(
      PlanId('plan-order'),
      [task('a'), task('b')],
      async (current) => {
        starts.push(String(current.id))
        await gates.get(String(current.id))!.promise
        return current.id
      },
      2,
      signal(),
    )
    await flush()
    gates.get('b')!.resolve(undefined)
    await flush()
    expect(starts).toEqual(['a', 'b'])
    gates.get('a')!.resolve(undefined)
    const result = await run
    expect(result.tasks.map(item => item.id)).toEqual([PlanTaskId('a'), PlanTaskId('b')])
    expect(starts).toEqual(['a', 'b'])
  })

  it('does not start queued tasks after cancellation', async () => {
    const controller = new AbortController()
    const gate = deferred<undefined>()
    const starts: string[] = []
    const run = executePlanTasks(
      PlanId('plan-cancel'),
      [task('a'), task('b'), task('c')],
      async (current) => {
        starts.push(String(current.id))
        await gate.promise
        return current.id
      },
      2,
      controller.signal,
    )
    await flush()
    expect(starts).toEqual(['a', 'b'])
    controller.abort()
    gate.resolve(undefined)
    const result = await run
    expect(result.outcome).toBe('cancelled')
    expect(starts).toEqual(['a', 'b'])
    expect(result.tasks[2]!.status).toBe('pending')
  })

  it('serializes conflicting resources and exclusive tasks', async () => {
    const starts: string[] = []
    const result = await executePlanTasks(
      PlanId('plan-resources'),
      [task('write-a', [], ['file']), task('write-b', [], ['file']), task('read', [], ['other'])],
      async (current) => { starts.push(String(current.id)); return current.id },
      3,
      signal(),
    )
    expect(result.outcome).toBe('completed')
    expect(starts.slice(0, 2).sort()).toEqual(['read', 'write-a'].sort())
    expect(starts[2]).toBe('write-b')
  })

  it.each([
    ['empty', [] as PlanTaskSpec[], 'at least one task'],
    ['duplicate', [task('a'), task('a')], 'repeats task id'],
    ['unknown dependency', [task('a', ['missing'])], 'unknown dependency'],
    ['cycle', [task('a', ['b']), task('b', ['a'])], 'dependency cycle'],
  ])('rejects a %s graph before execution', async (_name, tasks, message) => {
    await expect(executePlanTasks(PlanId('invalid'), tasks, async () => 'never', 1, signal()))
      .rejects.toThrow(message)
    await expect(executePlanTasks(PlanId('invalid'), tasks, async () => 'never', 1, signal()))
      .rejects.toBeInstanceOf(PlanGraphError)
  })
})
