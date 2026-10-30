// src/graphql/focus.ts
import { gql } from "@apollo/client";

const ERRORS = "errors { field code message }";

export const FOCUS_SESSIONS = gql`
  query FocusSessions($since: String!) {
    focusSessions(since: $since) { id startedAt seconds plannedSeconds taskTitle course { id code color } }
  }
`;
export const LOG_FOCUS = gql`
  mutation LogFocusSession($input: FocusInput!) {
    logFocusSession(input: $input) { session { id } ${ERRORS} }
  }
`;
export const DELETE_FOCUS = gql`mutation DeleteFocusSession($id: ID!) { deleteFocusSession(id: $id) { ok ${ERRORS} } }`;

export type FocusSession = {
  id: string; startedAt: string; seconds: number; plannedSeconds: number; taskTitle: string | null;
  course: { id: string; code: string; color: string } | null;
};

/** 90 -> "1m", 5400 -> "1h 30m", 20 -> "20s". */
export function fmtDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}