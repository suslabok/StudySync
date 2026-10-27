// src/graphql/sharing.ts
import { gql } from "@apollo/client";

const PERSON = gql`fragment PersonFields on Person { id displayName avatarUrl }`;
const ERRORS = "errors { field code message }";

const SPACE_FIELDS = gql`
  fragment SpaceFields on CourseSpace {
    courseId code title color shared mode role isOwner joinCode memberCount
    teacher { ...PersonFields }
    members { role joinedAt user { ...PersonFields } }
  }
  ${PERSON}
`;

export const COURSE_SPACE = gql`
  query CourseSpace($courseId: ID!) { courseSpace(courseId: $courseId) { ...SpaceFields } }
  ${SPACE_FIELDS}
`;

export const POSTS = gql`
  query Posts($courseId: ID!) {
    posts(courseId: $courseId) {
      id body createdAt canDelete
      author { ...PersonFields }
      comments { id body createdAt canDelete author { ...PersonFields } }
    }
  }
  ${PERSON}
`;

export const SHARE_COURSE = gql`
  mutation ShareCourse($courseId: ID!, $mode: String!) {
    shareCourse(courseId: $courseId, mode: $mode) { space { ...SpaceFields } ${ERRORS} }
  }
  ${SPACE_FIELDS}
`;
export const REGENERATE_CODE = gql`
  mutation RegenerateJoinCode($courseId: ID!) {
    regenerateJoinCode(courseId: $courseId) { space { ...SpaceFields } ${ERRORS} }
  }
  ${SPACE_FIELDS}
`;
export const STOP_SHARING = gql`
  mutation StopSharing($courseId: ID!) {
    stopSharing(courseId: $courseId) { space { ...SpaceFields } ${ERRORS} }
  }
  ${SPACE_FIELDS}
`;
export const JOIN_COURSE = gql`
  mutation JoinCourse($code: String!) {
    joinCourse(code: $code) { space { ...SpaceFields } ${ERRORS} }
  }
  ${SPACE_FIELDS}
`;
export const LEAVE_COURSE = gql`mutation LeaveCourse($courseId: ID!) { leaveCourse(courseId: $courseId) { ok ${ERRORS} } }`;
export const CREATE_POST = gql`mutation CreatePost($courseId: ID!, $body: String!) { createPost(courseId: $courseId, body: $body) { ok ${ERRORS} } }`;
export const DELETE_POST = gql`mutation DeletePost($id: ID!) { deletePost(id: $id) { ok ${ERRORS} } }`;
export const CREATE_COMMENT = gql`mutation CreateComment($postId: ID!, $body: String!) { createComment(postId: $postId, body: $body) { ok ${ERRORS} } }`;
export const DELETE_COMMENT = gql`mutation DeleteComment($id: ID!) { deleteComment(id: $id) { ok ${ERRORS} } }`;

export type Person = { id: string; displayName: string; avatarUrl: string | null };
export type CourseSpace = {
  courseId: string; code: string; title: string; color: string;
  shared: boolean; mode: "classroom" | "group" | null; role: "teacher" | "student" | "member" | null;
  isOwner: boolean; joinCode: string | null; memberCount: number; teacher: Person | null;
  members: { role: string; joinedAt: string; user: Person }[];
};
export type StreamComment = { id: string; body: string; createdAt: string; canDelete: boolean; author: Person };
export type StreamPost = { id: string; body: string; createdAt: string; canDelete: boolean; author: Person; comments: StreamComment[] };

export const ROLE_LABEL = { teacher: "Teacher", student: "Student", member: "Member" } as const;