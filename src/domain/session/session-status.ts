export type SessionStatus = 
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

export function isTerminalStatus(status: SessionStatus): boolean {
  return status === 'completed' || status === 'failed';
}

export function isResumableStatus(status: SessionStatus): boolean {
  return status === 'paused' || status === 'failed';
}
