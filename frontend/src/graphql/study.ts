// src/graphql/study.ts
import { gql } from "@apollo/client";

const ERRORS = "errors { field code message }";
const MATERIAL = `id title sourceKind fileName charCount excerpt generatedBy generatedAt createdAt
  questionCount shortCount cardCount attempts bestPercent
  notes { summary points terms { term meaning } }`;

export const STUDY_CONFIG = gql`query StudyConfig { studyConfig { aiEnabled maxMb maxChars } }`;
export const STUDY_MATERIALS = gql`query StudyMaterials { studyMaterials { ${MATERIAL} } }`;
export const STUDY_MATERIAL = gql`query StudyMaterial($id: ID!) { studyMaterial(id: $id) { ${MATERIAL} } }`;
export const STUDY_QUESTIONS = gql`
  query StudyQuestions($materialId: ID!, $kind: String!) { studyQuestions(materialId: $materialId, kind: $kind) { id kind prompt options } }
`;
export const STUDY_CARDS = gql`query StudyCards($materialId: ID!) { studyCards(materialId: $materialId) { id front back right wrong weak } }`;
export const STUDY_ATTEMPTS = gql`query StudyAttempts($materialId: ID!) { studyAttempts(materialId: $materialId) { id kind score total percent createdAt } }`;

export const CREATE_MATERIAL = gql`
  mutation CreateStudyMaterial($input: StudyInput!) { createStudyMaterial(input: $input) { material { id } ${ERRORS} } }
`;
export const GENERATE_STUDY = gql`
  mutation GenerateStudy($materialId: ID!) { generateStudy(materialId: $materialId) { material { ${MATERIAL} } message ${ERRORS} } }
`;
export const DELETE_MATERIAL = gql`mutation DeleteStudyMaterial($id: ID!) { deleteStudyMaterial(id: $id) { ok ${ERRORS} } }`;
export const SUBMIT_QUIZ = gql`
  mutation SubmitQuiz($materialId: ID!, $answers: [QuizAnswer!]!) {
    submitQuiz(materialId: $materialId, answers: $answers) {
      result { score total percent results { questionId choice correctIndex correct explanation } } ${ERRORS}
    }
  }
`;
export const SUBMIT_SHORT = gql`
  mutation SubmitShort($materialId: ID!, $answers: [ShortAnswer!]!) {
    submitShortAnswers(materialId: $materialId, answers: $answers) {
      result { score total percent gradedBy results { questionId answer score feedback reference } } ${ERRORS}
    }
  }
`;
export const RECORD_CARD = gql`
  mutation RecordCard($cardId: ID!, $knew: Boolean!) { recordCard(cardId: $cardId, knew: $knew) { card { id right wrong weak } ${ERRORS} } }
`;

export type Notes = { summary: string; points: string[]; terms: { term: string; meaning: string }[] };
export type Material = {
  id: string; title: string; sourceKind: "text" | "file"; fileName: string | null; charCount: number; excerpt: string;
  generatedBy: "ai" | "basic" | null; generatedAt: string | null; createdAt: string;
  questionCount: number; shortCount: number; cardCount: number; attempts: number; bestPercent: number | null;
  notes: Notes | null;
};
export type Question = { id: string; kind: string; prompt: string; options: string[] | null };
export type Card = { id: string; front: string; back: string; right: number; wrong: number; weak: boolean };
export type Attempt = { id: string; kind: "quiz" | "short"; score: number; total: number; percent: number; createdAt: string };
export type QuizItem = { questionId: string; choice: number | null; correctIndex: number; correct: boolean; explanation: string | null };
export type ShortItem = { questionId: string; answer: string; score: number; feedback: string; reference: string };

export const ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg";