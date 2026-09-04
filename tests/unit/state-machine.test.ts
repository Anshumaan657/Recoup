import { describe, it, expect } from "vitest";
import {
  RecoveryStatus,
  RecoveryAction,
} from "@/types/domain";
import {
  canTransition,
  transition,
  applyLateCapture,
  isTerminal,
  getNextStatusForAction,
  getValidNextStatuses,
  StateTransitionError,
} from "@/lib/recovery/state-machine";

describe("State Machine", () => {
  describe("canTransition", () => {
    it("allows valid transitions from waiting", () => {
      expect(canTransition(RecoveryStatus.waiting, RecoveryStatus.eligible)).toBe(true);
      expect(canTransition(RecoveryStatus.waiting, RecoveryStatus.closed)).toBe(true);
      expect(canTransition(RecoveryStatus.waiting, RecoveryStatus.manual_review)).toBe(true);
    });

    it("allows valid transitions from eligible", () => {
      expect(canTransition(RecoveryStatus.eligible, RecoveryStatus.contacted)).toBe(true);
      expect(canTransition(RecoveryStatus.eligible, RecoveryStatus.closed)).toBe(true);
      expect(canTransition(RecoveryStatus.eligible, RecoveryStatus.manual_review)).toBe(true);
    });

    it("allows valid transitions from contacted", () => {
      expect(canTransition(RecoveryStatus.contacted, RecoveryStatus.recovered)).toBe(true);
      expect(canTransition(RecoveryStatus.contacted, RecoveryStatus.closed)).toBe(true);
      expect(canTransition(RecoveryStatus.contacted, RecoveryStatus.manual_review)).toBe(true);
    });

    it("allows valid transitions from manual_review", () => {
      expect(canTransition(RecoveryStatus.manual_review, RecoveryStatus.contacted)).toBe(true);
      expect(canTransition(RecoveryStatus.manual_review, RecoveryStatus.closed)).toBe(true);
      expect(canTransition(RecoveryStatus.manual_review, RecoveryStatus.recovered)).toBe(true);
    });

    it("allows self-transitions", () => {
      expect(canTransition(RecoveryStatus.waiting, RecoveryStatus.waiting)).toBe(true);
      expect(canTransition(RecoveryStatus.recovered, RecoveryStatus.recovered)).toBe(true);
    });

    it("rejects invalid transitions from waiting", () => {
      expect(canTransition(RecoveryStatus.waiting, RecoveryStatus.contacted)).toBe(false);
      expect(canTransition(RecoveryStatus.waiting, RecoveryStatus.recovered)).toBe(false);
    });

    it("rejects invalid transitions from eligible", () => {
      expect(canTransition(RecoveryStatus.eligible, RecoveryStatus.waiting)).toBe(false);
      expect(canTransition(RecoveryStatus.eligible, RecoveryStatus.recovered)).toBe(false);
    });

    it("rejects all transitions from recovered (terminal)", () => {
      expect(canTransition(RecoveryStatus.recovered, RecoveryStatus.waiting)).toBe(false);
      expect(canTransition(RecoveryStatus.recovered, RecoveryStatus.eligible)).toBe(false);
      expect(canTransition(RecoveryStatus.recovered, RecoveryStatus.contacted)).toBe(false);
      expect(canTransition(RecoveryStatus.recovered, RecoveryStatus.closed)).toBe(false);
      expect(canTransition(RecoveryStatus.recovered, RecoveryStatus.manual_review)).toBe(false);
    });

    it("rejects all transitions from closed (terminal)", () => {
      expect(canTransition(RecoveryStatus.closed, RecoveryStatus.waiting)).toBe(false);
      expect(canTransition(RecoveryStatus.closed, RecoveryStatus.eligible)).toBe(false);
      expect(canTransition(RecoveryStatus.closed, RecoveryStatus.contacted)).toBe(false);
      expect(canTransition(RecoveryStatus.closed, RecoveryStatus.recovered)).toBe(false);
      expect(canTransition(RecoveryStatus.closed, RecoveryStatus.manual_review)).toBe(false);
    });

    it("respects action-specific transitions", () => {
      expect(canTransition(RecoveryStatus.eligible, RecoveryStatus.contacted, RecoveryAction.create_payment_link)).toBe(true);
      expect(canTransition(RecoveryStatus.eligible, RecoveryStatus.contacted, RecoveryAction.suggest_alternate_method)).toBe(true);
      expect(canTransition(RecoveryStatus.waiting, RecoveryStatus.eligible, RecoveryAction.retry_later)).toBe(true);
      expect(canTransition(RecoveryStatus.waiting, RecoveryStatus.manual_review, RecoveryAction.manual_review)).toBe(true);
      expect(canTransition(RecoveryStatus.waiting, RecoveryStatus.closed, RecoveryAction.no_action)).toBe(true);
    });
  });

  describe("transition", () => {
    it("returns target status for valid transitions", () => {
      expect(transition(RecoveryStatus.waiting, RecoveryStatus.eligible)).toBe(RecoveryStatus.eligible);
      expect(transition(RecoveryStatus.eligible, RecoveryStatus.contacted, RecoveryAction.create_payment_link)).toBe(RecoveryStatus.contacted);
    });

    it("throws StateTransitionError for invalid transitions", () => {
      expect(() => transition(RecoveryStatus.waiting, RecoveryStatus.contacted)).toThrow(StateTransitionError);
      expect(() => transition(RecoveryStatus.recovered, RecoveryStatus.closed)).toThrow(StateTransitionError);
    });

    it("includes from/to status in error", () => {
      try {
        transition(RecoveryStatus.waiting, RecoveryStatus.recovered);
      } catch (e) {
        expect(e).toBeInstanceOf(StateTransitionError);
        expect((e as StateTransitionError).fromStatus).toBe(RecoveryStatus.waiting);
        expect((e as StateTransitionError).toStatus).toBe(RecoveryStatus.recovered);
      }
    });
  });

  describe("applyLateCapture", () => {
    it("closes waiting cases", () => {
      expect(applyLateCapture(RecoveryStatus.waiting)).toBe(RecoveryStatus.closed);
    });

    it("closes eligible cases", () => {
      expect(applyLateCapture(RecoveryStatus.eligible)).toBe(RecoveryStatus.closed);
    });

    it("closes contacted cases", () => {
      expect(applyLateCapture(RecoveryStatus.contacted)).toBe(RecoveryStatus.closed);
    });

    it("returns null for manual_review", () => {
      expect(applyLateCapture(RecoveryStatus.manual_review)).toBeNull();
    });

    it("returns null for recovered (terminal)", () => {
      expect(applyLateCapture(RecoveryStatus.recovered)).toBeNull();
    });

    it("returns null for closed (terminal)", () => {
      expect(applyLateCapture(RecoveryStatus.closed)).toBeNull();
    });
  });

  describe("isTerminal", () => {
    it("returns true for recovered", () => {
      expect(isTerminal(RecoveryStatus.recovered)).toBe(true);
    });

    it("returns true for closed", () => {
      expect(isTerminal(RecoveryStatus.closed)).toBe(true);
    });

    it("returns false for non-terminal states", () => {
      expect(isTerminal(RecoveryStatus.waiting)).toBe(false);
      expect(isTerminal(RecoveryStatus.eligible)).toBe(false);
      expect(isTerminal(RecoveryStatus.contacted)).toBe(false);
      expect(isTerminal(RecoveryStatus.manual_review)).toBe(false);
    });
  });

  describe("getNextStatusForAction", () => {
    it("returns contacted for create_payment_link from eligible", () => {
      expect(getNextStatusForAction(RecoveryStatus.eligible, RecoveryAction.create_payment_link)).toBe(RecoveryStatus.contacted);
    });

    it("returns contacted for suggest_alternate_method from eligible", () => {
      expect(getNextStatusForAction(RecoveryStatus.eligible, RecoveryAction.suggest_alternate_method)).toBe(RecoveryStatus.contacted);
    });

    it("returns eligible for retry_later from waiting", () => {
      expect(getNextStatusForAction(RecoveryStatus.waiting, RecoveryAction.retry_later)).toBe(RecoveryStatus.eligible);
    });

    it("returns manual_review for manual_review from any non-terminal", () => {
      expect(getNextStatusForAction(RecoveryStatus.waiting, RecoveryAction.manual_review)).toBe(RecoveryStatus.manual_review);
      expect(getNextStatusForAction(RecoveryStatus.eligible, RecoveryAction.manual_review)).toBe(RecoveryStatus.manual_review);
      expect(getNextStatusForAction(RecoveryStatus.contacted, RecoveryAction.manual_review)).toBe(RecoveryStatus.manual_review);
    });

    it("returns closed for no_action", () => {
      expect(getNextStatusForAction(RecoveryStatus.waiting, RecoveryAction.no_action)).toBe(RecoveryStatus.closed);
      expect(getNextStatusForAction(RecoveryStatus.eligible, RecoveryAction.no_action)).toBe(RecoveryStatus.closed);
    });

    it("returns null for invalid action/status combinations", () => {
      expect(getNextStatusForAction(RecoveryStatus.waiting, RecoveryAction.create_payment_link)).toBeNull();
      expect(getNextStatusForAction(RecoveryStatus.recovered, RecoveryAction.create_payment_link)).toBeNull();
    });
  });

  describe("getValidNextStatuses", () => {
    it("returns correct next statuses for waiting", () => {
      const next = getValidNextStatuses(RecoveryStatus.waiting);
      expect(next).toContain(RecoveryStatus.eligible);
      expect(next).toContain(RecoveryStatus.closed);
      expect(next).toContain(RecoveryStatus.manual_review);
      expect(next).not.toContain(RecoveryStatus.contacted);
      expect(next).not.toContain(RecoveryStatus.recovered);
    });

    it("returns correct next statuses for eligible", () => {
      const next = getValidNextStatuses(RecoveryStatus.eligible);
      expect(next).toContain(RecoveryStatus.contacted);
      expect(next).toContain(RecoveryStatus.closed);
      expect(next).toContain(RecoveryStatus.manual_review);
    });

    it("returns empty array for terminal states", () => {
      expect(getValidNextStatuses(RecoveryStatus.recovered)).toEqual([]);
      expect(getValidNextStatuses(RecoveryStatus.closed)).toEqual([]);
    });
  });
});