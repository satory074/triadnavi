import type { DeckContext, DeckTask, DeckTaskResult } from '../core/deckEval';

export type DeckWorkerRequest =
  | { type: 'init'; key: string; context: DeckContext }
  | { type: 'task'; key: string; task: DeckTask };

export type DeckWorkerResponse =
  | { type: 'result'; key: string; result: DeckTaskResult }
  | { type: 'error'; key: string; taskId: string; message: string };
