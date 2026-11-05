// src/graphql/meetings.ts
import { gql } from "@apollo/client";

export const COURSE_MEETING = gql`query CourseMeeting($courseId: ID!) { courseMeeting(courseId: $courseId) { url canEdit } }`;
export const SET_COURSE_MEETING = gql`
  mutation SetCourseMeeting($courseId: ID!, $url: String) {
    setCourseMeeting(courseId: $courseId, url: $url) { meeting { url canEdit } errors { field code message } }
  }
`;
export type CourseMeetingData = { courseMeeting: { url: string | null; canEdit: boolean } };