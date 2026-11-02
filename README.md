# StudySync

A study planner and classroom app. Plan your semester, track tasks and deadlines, share courses with classmates or a class, hand in work, and keep a focus timer and a calendar in one place.

## Features

**Planning**
- Semesters with a "current" semester, progress and days left.
- Courses with a code, title and colour (theme-matched palette).
- Personal tasks with notes, due date and file attachments.
- Dashboard with a semester summary, due-soon list and progress cards in the side panel.

**Sharing and classroom**
- A course can be shared as a **classroom** (the owner is the teacher and sets the work) or a **group** (members can all set work).
- Others join with a **join code**. Joining adds a copy of the course to their current semester.
- **Stream:** everyone in the course can post text and files, and comment.
- **Assignments:** work set on a shared course becomes a task for every student. Assigned tasks change status only by handing in (`submit` / `unsubmit`), not manually.
- **Work and hand-in:** open an assignment to read it, download its files, write an answer, attach files and submit. The teacher sees everyone's submissions.

**Files**
- Upload to tasks, assignments, submissions and stream posts (5 MB each, 10 per item).
- Stored on disk under `media/`, tracked in the database, downloaded through the API.
- Orphaned files are swept automatically (6-hour rate limit, 10-minute grace period).

**Calendar**
- Month view of task due dates, public holidays (offline, any supported country, English or Nepali names), your own events, exams and breaks.
- Optional **Bikram Sambat (Nepali) dates** next to each day, with Nepal's Saturday weekend.
- Day panel to add events or tasks on a date.

**Focus timer**
- Focus / short break / long break, with a custom length.
- Survives page reloads and closing the tab (it is based on an end time, not a counter).
- Finished sessions are logged against a course or task, with a 7-day chart, per-course totals and recent sessions.

**Notifications**
- Bell with an unread count, top-right on desktop and in the mobile header.
- Notified when: new work is assigned, someone posts in your course, someone replies to your post, someone joins your course.
- Due-soon reminders (overdue, due today, due within two days) are computed from your tasks in your timezone. No scheduler is needed.

**Accounts**
- Email and password and Google sign-in, JWT access and refresh tokens, profile with avatar.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS v4, React Router, Apollo Client 4 |
| API | GraphQL, schema-first, with Ariadne on FastAPI |
| Backend | Python, SQLAlchemy 2 (sync), Alembic |
| Database | PostgreSQL |
| Auth | JWT, Google Sign-In |
| Extras | `holidays` (Python, offline holiday data), `nepali-date-converter` (npm) |

There are no mocks: the frontend talks to the real GraphQL API and PostgreSQL.

## Project layout

```
backend/app/
  api.py              builds the GraphQL schema from all modules below
  schema.py           auth, current_user, shared error type
  models.py           all SQLAlchemy tables
  courses.py / courses_api.py       semesters, courses, dashboard
  tasks.py / tasks_api.py           tasks, assignments, hand-in rules
  sharing.py / sharing_api.py       sharing, join codes, stream, comments
  files.py            uploads, downloads, submissions, orphan cleanup
  agenda.py           holidays and personal calendar events
  focus.py            focus session log
  notifications.py    notifications and due-soon reminders
  profile.py / profile_api.py       profile and avatar
frontend/src/
  graphql/            gql documents and types (tasks, taskFiles, sharing, agenda, focus, notifications, dashboard)
  components/         AppShell (sidebar, side panel), NotificationBell, TaskWidgets, CourseSharing, forms
  pages/              Dashboard, Courses, Tasks, Calendar, Focus, Profile and more
```

The module pattern on the backend is the same everywhere: a service module holds the rules and a `*_api.py` (or the same file for small features) holds the GraphQL types and resolvers. Mutations return `{ result, errors: [UserError] }` so forms can show field errors.

## Setup

### Requirements
Python 3.11+, Node 20+, PostgreSQL.

### Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt   
python -m alembic upgrade head
python -m uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install                      
npm run dev
```

### Configuration (`.env`, never commit it)
Keep your existing database URL, JWT secret and Google client ID settings. 

Use a long random JWT secret. If one was ever shared or committed, rotate it.

### Migrations
```bash
python -m alembic revision --autogenerate -m "describe the change"
python -m alembic upgrade head
```
Always open the generated file and check it before upgrading.

### Routes
`/` dashboard, `/courses`, `/courses/:id`, `/tasks`, `/calendar`, `/focus`, `/profile`.

## GraphQL overview

- **Queries:** `semesters`, `dashboard`, `tasks`, `dueSoon`, `assignments`, `courseSpace`, `posts`, `files`, `fileContent`, `taskWork`, `submissions`, `events`, `holidays`, `holidayCountries`, `focusSessions`, `notifications`
- **Mutations:** `createSemester`, `updateSemester`, `deleteSemester`, `createCourse`, `updateCourse`, `deleteCourse`, `createTask`, `updateTask`, `setTaskStatus`, `deleteTask`, `createAssignment`, `updateAssignment`, `deleteAssignment`, `saveWork`, `attachFile`, `deleteFile`, `shareCourse`, `regenerateJoinCode`, `stopSharing`, `joinCourse`, `leaveCourse`, `createPost`, `deletePost`, `createComment`, `deleteComment`, `createEvent`, `updateEvent`, `deleteEvent`, `logFocusSession`, `deleteFocusSession`, `markNotificationRead`, `markAllNotificationsRead`

## Design notes

- **Theme:** dark plum sidebar, white main area, yellow right panel, coral accents. Colours are tokens in `index.css` (`plum-800/900`, `sun-300/400`, `coral-400`, `blush`).
- **Tailwind v4:** use the canonical class names (`wrap-break-word`, `border-(--c)`, `bg-linear-to-br`).
- **Security:** every query and mutation checks ownership or course membership. Users outside a course get "not found". Files are served only to people who can see their parent item, and stored under random names, never the uploaded filename.