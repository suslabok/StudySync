import { gql } from "@apollo/client";

export type Course = { id: string; code: string; title: string; color: string; instructor: string | null };
export type Semester = { id: string; name: string; startDate: string; endDate: string };
export type DashboardData = { dashboard: { currentSemester: Semester | null; courses: Course[] } };

export const DASHBOARD = gql`
  query Dashboard {
    dashboard {
      currentSemester { id name startDate endDate }
      courses { id code title color instructor }
    }
  }
`;

export const CREATE_SEMESTER = gql`
  mutation CreateSemester($name: String!, $startDate: Date!, $endDate: Date!) {
    createSemester(name: $name, startDate: $startDate, endDate: $endDate) {
      semester { id }
      errors { field code message }
    }
  }
`;

export const CREATE_COURSE = gql`
  mutation CreateCourse($code: String!, $title: String!, $color: String, $instructor: String) {
    createCourse(code: $code, title: $title, color: $color, instructor: $instructor) {
      course { id code title color instructor }
      errors { field code message }
    }
  }
`;

export const DELETE_COURSE = gql`
  mutation DeleteCourse($id: ID!) { deleteCourse(id: $id) }
`;