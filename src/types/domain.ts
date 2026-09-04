export enum RecoveryStatus {
  waiting = "waiting",
  eligible = "eligible",
  contacted = "contacted",
  recovered = "recovered",
  closed = "closed",
  manual_review = "manual_review",
}

export enum RecoveryAction {
  retry_later = "retry_later",
  suggest_alternate_method = "suggest_alternate_method",
  create_payment_link = "create_payment_link",
  manual_review = "manual_review",
  no_action = "no_action",
}

export enum AuditEventType {
  payment_failed_received = "payment_failed_received",
  grace_started = "grace_started",
  late_capture_received = "late_capture_received",
  decision_created = "decision_created",
  decision_rejected = "decision_rejected",
  payment_link_created = "payment_link_created",
  notification_queued = "notification_queued",
  recovery_succeeded = "recovery_succeeded",
  recovery_stopped = "recovery_stopped",
  manual_review_requested = "manual_review_requested",
  provider_error = "provider_error",
}

export interface RecoveryCase {
  id: string;
  originalPaymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  customerContact: string | null;
  paymentMethod: string | null;
  failureCode: string | null;
  failureReason: string | null;
  failureSource: string | null;
  failureStep: string | null;
  attemptCount: number;
  status: RecoveryStatus;
  selectedAction: RecoveryAction | null;
  decisionReason: string | null;
  confidence: number | null;
  requiresApproval: boolean;
  graceExpiresAt: Date | null;
  paymentLinkId: string | null;
  paymentLinkUrl: string | null;
  paymentLinkExpiry: Date | null;
  recoveredAmount: number | null;
  recoveredAt: Date | null;
  stoppedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEvent {
  id: string;
  recoveryCaseId: string;
  eventType: AuditEventType;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface WebhookReceipt {
  id: string;
  eventKey: string;
  providerEvent: string;
  payloadHash: string;
  processedAt: Date;
  outcome: string;
}

export interface NotificationOutbox {
  id: string;
  recoveryCaseId: string;
  channel: string;
  recipient: string;
  message: string;
  status: string;
  providerReference: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface RecoveryDecision {
  action: RecoveryAction;
  reason: string;
  delaySeconds: number;
  customerMessage: string;
  confidence: number;
  requiresApproval: boolean;
  modelMetadata?: Record<string, unknown>;
  fallbackUsed?: boolean;
  fallbackReason?: string;
}

export interface PolicyResult {
  proposedDecision: RecoveryDecision;
  approvedDecision: RecoveryDecision | null;
  rejectedReasons: string[];
  fallbackUsed: boolean;
}

export interface RecoveryCaseWithTimeline extends RecoveryCase {
  auditEvents: AuditEvent[];
}

export interface ListCasesOptions {
  status?: RecoveryStatus;
  action?: RecoveryAction;
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}