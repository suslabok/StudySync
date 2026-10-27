import { gql } from "@apollo/client";

export type Profile = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  onboarded: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  createdAt: string;
  avatarUrl: string | null;
};
export type ProfileData = { me: Profile };

export const PROFILE = gql`
  query Profile {
    me { id email displayName timezone onboarded hasPassword googleLinked createdAt avatarUrl }
  }
`;

export const UPDATE_PROFILE = gql`
  mutation UpdateProfile($displayName: String!, $timezone: String!) {
    updateProfile(displayName: $displayName, timezone: $timezone) {
      user { id displayName timezone }
      errors { field code message }
    }
  }
`;

export const CHANGE_PASSWORD = gql`
  mutation ChangePassword($currentPassword: String, $newPassword: String!) {
    changePassword(currentPassword: $currentPassword, newPassword: $newPassword) {
      user { id hasPassword }
      errors { field code message }
    }
  }
`;

export const UPLOAD_AVATAR = gql`
  mutation UploadAvatar($image: String!) {
    uploadAvatar(image: $image) {
      user { id avatarUrl }
      errors { field code message }
    }
  }
`;

export const REMOVE_AVATAR = gql`
  mutation RemoveAvatar {
    removeAvatar {
      user { id avatarUrl }
      errors { field code message }
    }
  }
`;