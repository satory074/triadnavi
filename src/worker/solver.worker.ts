import { createContext, runTask, type SolveContext } from '../core/analyze';
import type { WorkerRequest, WorkerResponse } from './protocol';

// runTask を包むだけの殻。探索は同期処理でメッセージでは止められないので、
// 中断はメインスレッド側が terminate() して作り直す(hooks/useSolver.ts)。
let ctx: SolveContext | null = null;
let key = '';

const send = (msg: WorkerResponse) => postMessage(msg);

addEventListener('message', (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    ctx = createContext(msg.position, msg.worlds);
    key = msg.key;
    return;
  }
  if (!ctx || msg.key !== key) return;
  try {
    send({ type: 'result', key, result: runTask(ctx, msg.task) });
  } catch (e) {
    send({ type: 'error', key, taskId: msg.task.id, message: e instanceof Error ? e.message : String(e) });
  }
});
