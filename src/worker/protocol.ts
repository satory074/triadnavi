import type { Task, TaskResult } from '../core/analyze';
import type { Position } from '../core/position';
import type { World } from '../core/worlds';

export type WorkerRequest =
  | { type: 'init'; key: string; position: Position; worlds: World[] }
  | { type: 'task'; key: string; task: Task };

export type WorkerResponse =
  | { type: 'result'; key: string; result: TaskResult }
  | { type: 'error'; key: string; taskId: string; message: string };
