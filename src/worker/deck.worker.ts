import { runDeckTask, type DeckContext } from '../core/deckEval';
import type { DeckWorkerRequest, DeckWorkerResponse } from './deckProtocol';

// runDeckTask を包むだけの殻(solver.worker.ts と同じ作り)。中断はメインスレッド側が terminate() して作り直す
let ctx: DeckContext | null = null;
let key = '';

const send = (msg: DeckWorkerResponse) => postMessage(msg);

addEventListener('message', (ev: MessageEvent<DeckWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    ctx = msg.context;
    key = msg.key;
    return;
  }
  if (!ctx || msg.key !== key) return;
  try {
    send({ type: 'result', key, result: runDeckTask(ctx, msg.task) });
  } catch (e) {
    send({ type: 'error', key, taskId: msg.task.id, message: e instanceof Error ? e.message : String(e) });
  }
});
