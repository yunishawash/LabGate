/** The four ways a measured value is judged. Kept here so route validation and
 *  the schema enum can never disagree. */
export const LAB_OPERATORS = ["n_m_t", "n_l_t", "range", "none"] as const;
export type LabOperatorValue = (typeof LAB_OPERATORS)[number];

export const LAB_SHIFTS = ["morning", "afternoon", "night", ""] as const;
export const LAB_STATUSES = ["pass", "warning", "fail"] as const;
export const LAB_DECISIONS = ["pending", "accepted", "rejected"] as const;
