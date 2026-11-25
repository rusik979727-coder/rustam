export const ROLES = ["HEAD_MANAGER", "MANAGER", "DOCTOR"] as const;
export type Role = (typeof ROLES)[number];

export const LEAD_STATUSES = ["NEW", "CONTACTED", "BOOKED", "ARRIVED", "PAID", "LOST"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const OPEN_LEAD_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "BOOKED", "ARRIVED"];

export const LEAD_SOURCES = ["INSTAGRAM", "WHATSAPP", "2GIS", "SITE", "CALL", "REFERRAL", "OTHER"] as const;
export const COMPLAINTS = ["HERNIA", "PROTRUSION", "ARTHROSIS", "ARTHRITIS", "OTHER"] as const;
export const APPT_STATUSES = ["BOOKED", "CONFIRMED", "ARRIVED", "NO_SHOW", "CANCELLED"] as const;
export type ApptStatus = (typeof APPT_STATUSES)[number];
export const ACTIVE_APPT_STATUSES: ApptStatus[] = ["BOOKED", "CONFIRMED", "ARRIVED"];
export const PAYMENT_METHODS = ["KASPI", "CASH", "CARD", "TRANSFER"] as const;
export const LOST_REASONS = ["EXPENSIVE", "FAR", "NO_ANSWER", "OTHER_CLINIC", "NOT_NOW", "OTHER"] as const;
