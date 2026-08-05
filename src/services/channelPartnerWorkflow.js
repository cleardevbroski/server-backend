const transitions = {
  active: new Set(["suspended"]),
  submitted: new Set(["under_review", "rejected"]),
  under_review: new Set(["changes_requested", "approved", "rejected"]),
  changes_requested: new Set(["resubmitted"]),
  resubmitted: new Set(["under_review", "rejected"]),
  approved: new Set(["suspended"]),
  suspended: new Set(["active", "approved", "rejected"]),
  rejected: new Set(["under_review"]),
};

function canTransition(from, to) {
  return Boolean(transitions[from]?.has(to));
}

function transitionRequiresReason(status) {
  return ["changes_requested", "rejected", "suspended"].includes(status);
}

module.exports = { canTransition, transitionRequiresReason };
