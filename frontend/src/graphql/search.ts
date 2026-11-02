import { gql } from "@apollo/client";

export const SEARCH = gql`
  query Search($q: String!) {
    search(q: $q) { kind id title snippet createdAt course { id code color } }
  }
`;

export type SearchHit = {
  kind: "task" | "post" | "comment" | "assignment"; id: string; title: string | null; snippet: string;
  createdAt: string; course: { id: string; code: string; color: string } | null;
};

/** Splits a snippet on the ⟦ ⟧ markers the server puts around matches. Odd parts are the matches. */
export const snippetParts = (s: string) => s.split(/⟦|⟧/);

/** Where a result lives. A course's id is always the viewer's own, so these links work for everyone. */
export function hitLink(h: SearchHit) {
  const c = h.course?.id;
  if (h.kind === "task") return "/tasks";
  if (!c) return "/";
  if (h.kind === "assignment") return `/courses/${c}?tab=assignments`;
  return `/courses/${c}`;
}