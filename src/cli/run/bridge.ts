/**
 * Connects the orchestrator's `approve(request)` callback to the TUI's
 * `onApprove(approvalId, approved)`. The orchestrator emits
 * `approval.request` (with the approvalId) right before calling approve(),
 * one approval at a time, so the latest observed request identifies it.
 */
import type { EduEvent } from '../../core/contracts.js';
import type { ApprovalRequest } from '../../orchestrator/index.js';

export class ApprovalBridge {
  private current?: string;
  private readonly waiting = new Map<string, (approved: boolean) => void>();
  private readonly early = new Map<string, boolean>();

  observe(event: EduEvent): void {
    if (event.type === 'approval.request') this.current = event.approvalId;
  }

  readonly approve = (_request: ApprovalRequest): Promise<boolean> => {
    const id = this.current;
    if (!id) return Promise.resolve(false);
    const answered = this.early.get(id);
    if (answered !== undefined) {
      this.early.delete(id);
      return Promise.resolve(answered);
    }
    return new Promise((resolve) => this.waiting.set(id, resolve));
  };

  readonly answer = (approvalId: string, approved: boolean): void => {
    const resolve = this.waiting.get(approvalId);
    if (resolve) {
      this.waiting.delete(approvalId);
      resolve(approved);
    } else {
      this.early.set(approvalId, approved);
    }
  };

  /** Rejects every outstanding approval (used on cancel/quit). */
  rejectAll(): void {
    for (const [id, resolve] of this.waiting) {
      this.waiting.delete(id);
      resolve(false);
    }
  }
}
