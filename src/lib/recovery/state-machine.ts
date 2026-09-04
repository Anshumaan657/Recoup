import { RecoveryStatus, RecoveryAction } from "@/types/domain";

export class StateTransitionError extends Error {
  constructor(
    message: string,
    public readonly fromStatus: RecoveryStatus,
    public readonly toStatus: RecoveryStatus,
    public readonly action?: RecoveryAction
  ) {
    super(message);
    this.name = "StateTransitionError";
  }
}

const validTransitions: Record<RecoveryStatus, RecoveryStatus[]> = {
  [RecoveryStatus.waiting]: [
    RecoveryStatus.eligible,
    RecoveryStatus.closed,
    RecoveryStatus.manual_review,
  ],
  [RecoveryStatus.eligible]: [
    RecoveryStatus.contacted,
    RecoveryStatus.closed,
    RecoveryStatus.manual_review,
  ],
  [RecoveryStatus.contacted]: [
    RecoveryStatus.recovered,
    RecoveryStatus.closed,
    RecoveryStatus.manual_review,
  ],
  [RecoveryStatus.manual_review]: [
    RecoveryStatus.contacted,
    RecoveryStatus.closed,
    RecoveryStatus.recovered,
  ],
  [RecoveryStatus.recovered]: [],
  [RecoveryStatus.closed]: [],
};

export function canTransition(
  from: RecoveryStatus,
  to: RecoveryStatus,
  action?: RecoveryAction
): boolean {
  if (from === to) return true;

  const allowed = validTransitions[from] || [];
  if (!allowed.includes(to)) return false;

  if (action === RecoveryAction.create_payment_link) {
    return to === RecoveryStatus.contacted;
  }

  if (action === RecoveryAction.retry_later) {
    return to === RecoveryStatus.eligible;
  }

  if (action === RecoveryAction.suggest_alternate_method) {
    return to === RecoveryStatus.contacted;
  }

  if (action === RecoveryAction.manual_review) {
    return to === RecoveryStatus.manual_review;
  }

  if (action === RecoveryAction.no_action) {
    return to === RecoveryStatus.closed;
  }

  return true;
}

export function transition(
  currentStatus: RecoveryStatus,
  targetStatus: RecoveryStatus,
  action?: RecoveryAction
): RecoveryStatus {
  if (!canTransition(currentStatus, targetStatus, action)) {
    throw new StateTransitionError(
      `Invalid transition from ${currentStatus} to ${targetStatus}${action ? ` via action ${action}` : ""}`,
      currentStatus,
      targetStatus,
      action
    );
  }
  return targetStatus;
}

export function applyLateCapture(currentStatus: RecoveryStatus): RecoveryStatus | null {
  if ([RecoveryStatus.waiting, RecoveryStatus.eligible, RecoveryStatus.contacted].includes(currentStatus)) {
    return RecoveryStatus.closed;
  }
  return null;
}

export function isTerminal(status: RecoveryStatus): boolean {
  return status === RecoveryStatus.recovered || status === RecoveryStatus.closed;
}

export function getNextStatusForAction(
  currentStatus: RecoveryStatus,
  action: RecoveryAction
): RecoveryStatus | null {
  switch (action) {
    case RecoveryAction.create_payment_link:
    case RecoveryAction.suggest_alternate_method:
      return currentStatus === RecoveryStatus.eligible ? RecoveryStatus.contacted : null;
    case RecoveryAction.retry_later:
      return currentStatus === RecoveryStatus.waiting ? RecoveryStatus.eligible : null;
    case RecoveryAction.manual_review:
      return RecoveryStatus.manual_review;
    case RecoveryAction.no_action:
      return RecoveryStatus.closed;
    default:
      return null;
  }
}

export function getValidNextStatuses(currentStatus: RecoveryStatus): RecoveryStatus[] {
  return validTransitions[currentStatus] || [];
}