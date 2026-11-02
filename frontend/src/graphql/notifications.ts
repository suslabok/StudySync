// src/graphql/notifications.ts
import { gql } from "@apollo/client";

export const NOTIFICATIONS = gql`
  query Notifications {
    notifications {
      unread
      items { id kind title body read createdAt courseId }
      reminders { taskId title courseCode dueDate overdue }
    }
  }
`;
export const MARK_READ = gql`mutation MarkNotificationRead($id: ID!) { markNotificationRead(id: $id) }`;
export const MARK_ALL_READ = gql`mutation MarkAllNotificationsRead { markAllNotificationsRead }`;

export type AppNotification = {
  id: string; kind: "assignment" | "post" | "comment" | "joined"; title: string; body: string | null;
  read: boolean; createdAt: string; courseId: string | null;
};
export type Reminder = { taskId: string; title: string; courseCode: string | null; dueDate: string; overdue: boolean };
export type NotificationsData = { notifications: { unread: number; items: AppNotification[]; reminders: Reminder[] } };

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}