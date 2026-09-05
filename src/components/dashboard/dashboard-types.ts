export interface DashboardMetrics {
  runId: string | null;
  datasetVersion: string | null;
  synthetic: boolean;
  attempted: number;
  contacted: number;
  recovered: number;
  stopped: number;
  manualReview: number;
  duplicatesPrevented: number;
  totalCases: number;
  totalAtRiskPaise: number;
  recoveredPaise: number;
  recoveryRate: number;
  generatedAt: string;
  dataset: "synthetic";
}

export interface RecoverySummary {
  id: string;
  originalPaymentId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  customerContact: string | null;
  paymentMethod: string | null;
  failureReason: string | null;
  attemptCount: number;
  status: string;
  selectedAction: string | null;
  requiresApproval: boolean;
  hasPaymentLink: boolean;
  recoveredAmountPaise: number | null;
  stoppedReason: string | null;
  synthetic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditTimelineEntry {
  id: string;
  eventType: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RecoveryDetail extends RecoverySummary {
  failureCode: string | null;
  decisionReason: string | null;
  confidence: number | null;
  paymentLinkExpiry: string | null;
  recoveredAt: string | null;
  auditTimeline: AuditTimelineEntry[];
}

export interface RecoveriesResponse {
  data: RecoverySummary[];
  pagination: { total: number; limit: number; offset: number };
}
