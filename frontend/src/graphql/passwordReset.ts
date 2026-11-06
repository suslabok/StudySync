// src/graphql/passwordReset.ts
import { gql } from "@apollo/client";

export const REQUEST_RESET = gql`
  mutation RequestPasswordReset($email: String!) { requestPasswordReset(email: $email) { ok errors { field code message } } }
`;
export const RESET_VALID = gql`query PasswordResetValid($token: String!) { passwordResetValid(token: $token) }`;
export const RESET_PASSWORD = gql`
  mutation ResetPassword($token: String!, $newPassword: String!) {
    resetPassword(token: $token, newPassword: $newPassword) { ok errors { field code message } }
  }
`;