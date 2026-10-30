// src/graphql/agenda.ts
import { gql } from "@apollo/client";

const ERRORS = "errors { field code message }";
const EVENT = "id title notes kind startDate endDate";

export const HOLIDAY_COUNTRIES = gql`query HolidayCountries { holidayCountries }`;
export const HOLIDAYS = gql`query Holidays($country: String!, $year: Int!, $language: String) { holidays(country: $country, year: $year, language: $language) { date name } }`;
export const EVENTS = gql`query Events($from: Date!, $to: Date!) { events(from: $from, to: $to) { ${EVENT} } }`;

export const CREATE_EVENT = gql`
  mutation CreateEvent($input: EventInput!) { createEvent(input: $input) { event { ${EVENT} } ${ERRORS} } }
`;
export const UPDATE_EVENT = gql`
  mutation UpdateEvent($id: ID!, $input: EventInput!) { updateEvent(id: $id, input: $input) { event { ${EVENT} } ${ERRORS} } }
`;
export const DELETE_EVENT = gql`mutation DeleteEvent($id: ID!) { deleteEvent(id: $id) { ok ${ERRORS} } }`;

export type EventKind = "event" | "exam" | "break";
export type CalendarEvent = {
  id: string; title: string; notes: string | null; kind: EventKind; startDate: string; endDate: string | null;
};
export type Holiday = { date: string; name: string };

export const KINDS: Record<EventKind, { label: string; color: string }> = {
  event: { label: "Event", color: "#6f58a0" },
  exam: { label: "Exam", color: "#d14d45" },
  break: { label: "Break", color: "#5f8a45" },
};