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

**Search**
- Full-text search (PostgreSQL) over your tasks, plus the stream posts, comments and assignments of courses you belong to. Results are ranked with highlighted snippets. Quotes, `-exclude` and `OR` work. You never see anyone else's private tasks.

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

**Study** (learning and testing)
- Add material by pasting text or uploading a PDF, Word, PowerPoint, text file or image. Only the extracted text is stored.
- Generates a summary, key points and terms, a multiple-choice quiz, flashcards and short-answer questions.
- Quizzes are marked on the server (answers are never sent to the browser before you submit). Short answers are marked by AI, or by keyword matching without it.
- Flashcards remember which ones you find hard. Every quiz and short-answer round is saved, with a score chart per material.
- Uses Google's free Gemini API when `GEMINI_API_KEY` is set, and a basic built-in generator otherwise. Reading images and scanned PDFs needs the key.

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
  search.py           full-text search
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
pip install -r requirements.txt   # includes holidays
python -m alembic upgrade head
python -m uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install                       # includes nepali-date-converter
npm run dev
```

### Configuration (`.env`, never commit it)
Keep your existing database URL, JWT secret and Google client ID settings. These are optional:

| Variable | Default | Meaning |
|---|---|---|
| `MEDIA_DIR` | `media` | Where uploaded files are stored |
| `MAX_UPLOAD_MB` | `5` | Largest single upload |
| `GEMINI_API_KEY` | none | Free key from https://aistudio.google.com/apikey. Without it, Study uses basic mode |
| `GEMINI_MODEL` | `gemini-flash-latest` | Any Gemini model your key can use |

Free Gemini keys have daily limits, and Google may use free-tier prompts to improve its products, so don't upload private material you wouldn't want reviewed. Each user is limited to 12 AI generations an hour so one person can't use up the quota.

Use a long random JWT secret. If one was ever shared or committed, rotate it.

### Migrations
```bash
python -m alembic revision --autogenerate -m "describe the change"
python -m alembic upgrade head
```
Always open the generated file and check it before upgrading.

### Routes
`/` dashboard, `/courses`, `/courses/:id`, `/tasks`, `/calendar`, `/focus`, `/study`, `/study/:id`, `/search`, `/profile`.

## GraphQL overview

- **Queries:** `semesters`, `dashboard`, `tasks`, `dueSoon`, `assignments`, `courseSpace`, `posts`, `files`, `fileContent`, `taskWork`, `submissions`, `events`, `holidays`, `holidayCountries`, `focusSessions`, `notifications`, `assignedByMe`, `search`
- **Mutations:** `createSemester`, `updateSemester`, `deleteSemester`, `createCourse`, `updateCourse`, `deleteCourse`, `createTask`, `updateTask`, `setTaskStatus`, `deleteTask`, `createAssignment`, `updateAssignment`, `deleteAssignment`, `saveWork`, `attachFile`, `deleteFile`, `shareCourse`, `regenerateJoinCode`, `stopSharing`, `joinCourse`, `leaveCourse`, `createPost`, `deletePost`, `createComment`, `deleteComment`, `createEvent`, `updateEvent`, `deleteEvent`, `logFocusSession`, `deleteFocusSession`, `markNotificationRead`, `markAllNotificationsRead`

## Design notes

- **Theme:** dark plum sidebar, white main area, yellow right panel, coral accents. Colours are tokens in `index.css` (`plum-800/900`, `sun-300/400`, `coral-400`, `blush`).
- **Tailwind v4:** use the canonical class names (`wrap-break-word`, `border-(--c)`, `bg-linear-to-br`).
- **Uploads:** an extension allow-list, a check that the file's first bytes match its type, a size cap (5 MB) and a per-item limit. Files are stored under random names.
- **Security:** every query and mutation checks ownership or course membership. Users outside a course get "not found". Files are served only to people who can see their parent item, and stored under random names, never the uploaded filename.
- **Logo:** put your image in `public/` and set `LOGO_SRC` at the top of `AppShell.tsx`.

## Before you deploy

- **Rotate secrets:** use a long random JWT secret. If one was ever pasted into chat, a screenshot or a commit, treat it as leaked and replace it. Same for the database password.
- **Keep `.env` out of git:** the included `.gitignore` covers `.env`, `.venv`, `node_modules` and `media/`. If `.env` was ever committed, remove it from the history, not just the latest commit.
- **HTTPS only,** and restrict the API's allowed origins (CORS) to your real frontend address.
- **Google sign-in:** add your production domain to the allowed origins of the Google client.
- **Uploads:** `media/` must be on persistent storage and backed up. Move to object storage before running more than one server.
- **Database:** run `python -m alembic upgrade head` on every deploy, and back up PostgreSQL.
- **Turn off auto-reload** (`--reload`) and debug settings in production.
