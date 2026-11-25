export const ROLES = ["HEAD_MANAGER", "MANAGER", "DOCTOR"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Клиниканың WhatsApp тізімдеріне сәйкес:
 * NEW=Лид, CONTACTED=Обработка, NO_ANSWER=Не отвечает, BOOKED=Конс, ARRIVED=Келді,
 * PAID=Емге төледі, LOST=Отказ, SPAM=Басылып кетті (қате/спам — статистикаға кірмейді)
 */
export const LEAD_STATUSES = ["NEW", "CONTACTED", "NO_ANSWER", "BOOKED", "ARRIVED", "PAID", "LOST", "SPAM"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const OPEN_LEAD_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "NO_ANSWER", "BOOKED", "ARRIVED"];
export const CLOSED_LEAD_STATUSES: LeadStatus[] = ["PAID", "LOST", "SPAM"];
/** «Басылып кетті» — нақты клиент емес, есептерге кірмейді */
export const NOT_SPAM = { status: { not: "SPAM" } } as const;
/** «Не отвечает» болғанда қайта хабарласу уақыты (сағат) */
export const NO_ANSWER_RETRY_HOURS = 2;

export const LEAD_SOURCES = ["INSTAGRAM", "WHATSAPP", "2GIS", "SITE", "CALL", "REFERRAL", "OTHER"] as const;
export const COMPLAINTS = ["HERNIA", "PROTRUSION", "ARTHROSIS", "ARTHRITIS", "OTHER"] as const;
export const APPT_STATUSES = ["BOOKED", "CONFIRMED", "ARRIVED", "NO_SHOW", "CANCELLED"] as const;
export type ApptStatus = (typeof APPT_STATUSES)[number];
export const ACTIVE_APPT_STATUSES: ApptStatus[] = ["BOOKED", "CONFIRMED", "ARRIVED"];
export const PAYMENT_METHODS = ["KASPI", "CASH", "CARD", "TRANSFER"] as const;
export const LOST_REASONS = ["EXPENSIVE", "FAR", "NO_ANSWER", "OTHER_CLINIC", "NOT_NOW", "OTHER"] as const;
