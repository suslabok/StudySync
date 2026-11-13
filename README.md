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
- **Who can edit:** in a classroom only the teacher (the owner) can rename or change the course; students see no Edit button. In a study group any member can. A rename by the person allowed to edit updates the course code and title for everyone in it. The colour stays personal.
- **Google Meet:** each course can have one Meet link. Members see a **Join meeting** button (opens in a new tab); only people who may edit the course can set or change it. Only `meet.google.com` links are accepted.
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
- Material can be linked to one of your courses. The list filters by course, and **Start focus** opens the Focus timer on that course.
- Generates a summary, key points and terms, a multiple-choice quiz, flashcards and short-answer questions.
- Quizzes are marked on the server (answers are never sent to the browser before you submit). Short answers are marked by AI, or by keyword matching without it.
- Flashcards remember which ones you find hard. Every quiz and short-answer round is saved, with a score chart per material.
- Uses Google's free Gemini API when `GEMINI_API_KEY` is set, and a basic built-in generator otherwise. Reading images and scanned PDFs needs the key.

**Accounts**
- Email and password and Google sign-in, profile with avatar.
- Short-lived access token (15 minutes) plus a 14-day rotating refresh token in an HttpOnly cookie. Reusing an old refresh token signs out that whole login family.
- **Forgot password:** emailed one-time link (random token, stored only as a hash, works once, expires in 1 hour, max 3 emails per account per hour). The form never reveals whether an email has an account. Changing the password signs the person out everywhere.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS v4, React Router, Apollo Client 4 |
| API | GraphQL, schema-first, with Ariadne on FastAPI |
| Backend | Python, SQLAlchemy 2 (sync), Alembic |
| Database | PostgreSQL |
| Auth | JWT, Argon2 password hashing, Google Sign-In |
| Deploy | Docker (one image), Render, Neon (PostgreSQL) |
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
  study.py / study_ai.py / study_models.py   Study materials, quizzes, flashcards, AI
  meetings.py / meeting_models.py   Google Meet link per course
  password_reset.py / reset_models.py   forgot-password emails and tokens
  spa.py              serves the built React app (production)
bootstrap_db.py       prepares the database on start (see Deploy)
frontend/src/
  graphql/            gql documents and types (tasks, taskFiles, sharing, agenda, focus, notifications, dashboard)
  components/         AppShell (sidebar, side panel), NotificationBell, TaskWidgets, CourseSharing, forms
  pages/              Dashboard, Courses, Tasks, Calendar, Focus, Profile and more
```

Deploy files: `Dockerfile`, `.dockerignore`, `DEPLOY.md`, `SMOKE_TEST.md`.

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

The frontend needs `frontend/.env` so it can find the API in development:
```
VITE_API_URL=http://localhost:8000/graphql
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```
Restart `npm run dev` after changing it. In production the API is on the same address, so the app falls back to `/graphql`.

If Windows blocks a Python package with "Application Control policy has blocked this file" (seen with SQLAlchemy's compiled helper), reinstall it without the compiled part:
```
$env:DISABLE_SQLALCHEMY_CEXT = "1"
python -m pip install --force-reinstall --no-binary sqlalchemy sqlalchemy
```

### Configuration (`backend/.env`, never commit it)
Required:

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg://user:password@host:5432/dbname` (add `?sslmode=require` for Neon) |
| `JWT_SECRET_KEY` | Long random string, different on every environment |
| `GOOGLE_CLIENT_ID` | OAuth client ID for Google sign-in |

Optional:

| Variable | Default | Meaning |
|---|---|---|
| `MEDIA_DIR` | `media` | Where uploaded files are stored |
| `MAX_UPLOAD_MB` | `5` | Largest single upload |
| `PUBLIC_API_URL` | `http://localhost:8000` | Address put in front of avatar image paths. On the live site set it to the site's own address, or photos point at localhost and the browser blocks them |
| `COOKIE_SECURE` | off | Set to `1` on HTTPS so the login cookie is Secure |
| `DEBUG` | off | `1` only on your own computer: shows error details, the `/docs` page and the GraphQL explorer. Never set it on the live site |
| `CSP_MODE` | `report` | Browser content policy: `report` (only logs problems in the browser Console), `enforce`, or `off` |
| `MAX_BODY_MB` | `12` | Largest request the server accepts |
| `GRAPHQL_MAX_DEPTH`, `GRAPHQL_MAX_FIELDS` | `12`, `1000` | Largest query the API accepts |
| `FRONTEND_URL` | `http://localhost:5173` | Where the reset-password link points |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | none | Mail server for reset emails. Without `SMTP_HOST` the link is printed in the server console |
| `GEMINI_API_KEY` | none | Free key from https://aistudio.google.com/apikey. Without it, Study uses basic mode |
| `GEMINI_MODEL` | `gemini-flash-latest` | Any Gemini model your key can use |
| `GEMINI_FALLBACK_MODEL` | `gemini-flash-lite-latest` | Tried when the main model is busy (503) or out of free quota. Empty turns it off |

Free Gemini keys have daily limits, and Google may use free-tier prompts to improve its products, so don't upload private material you wouldn't want reviewed. Each user is limited to 12 AI generations an hour so one person can't use up the quota.

Use a long random JWT secret (`python -c "import secrets; print(secrets.token_urlsafe(48))"`). If one was ever shared or committed, rotate it.

Local and live must not share a database by accident: whatever `DATABASE_URL` points at is the data you are editing.

### Migrations
```bash
python -m alembic revision --autogenerate -m "describe the change"
python -m alembic upgrade head
```
Always open the generated file and check it before upgrading.

### Routes
`/` dashboard, `/courses`, `/courses/:id`, `/tasks`, `/calendar`, `/forgot-password`, `/reset-password?token=…`, `/focus`, `/study`, `/study/:id`, `/search`, `/profile`.

## GraphQL overview

- **Queries:** `semesters`, `dashboard`, `tasks`, `dueSoon`, `assignments`, `courseSpace`, `posts`, `files`, `fileContent`, `taskWork`, `submissions`, `events`, `holidays`, `holidayCountries`, `focusSessions`, `notifications`, `assignedByMe`, `search`, `courseMeeting`, `studyMaterials`, `studyMaterial`, `passwordResetValid`
- **Mutations:** `createSemester`, `updateSemester`, `deleteSemester`, `createCourse`, `updateCourse`, `deleteCourse`, `createTask`, `updateTask`, `setTaskStatus`, `deleteTask`, `createAssignment`, `updateAssignment`, `deleteAssignment`, `saveWork`, `attachFile`, `deleteFile`, `shareCourse`, `regenerateJoinCode`, `stopSharing`, `joinCourse`, `leaveCourse`, `createPost`, `deletePost`, `createComment`, `deleteComment`, `createEvent`, `updateEvent`, `deleteEvent`, `logFocusSession`, `deleteFocusSession`, `markNotificationRead`, `markAllNotificationsRead`, `setCourseMeeting`, `createStudyMaterial`, `updateStudyMaterial`, `deleteStudyMaterial`, `requestPasswordReset`, `resetPassword`, `uploadAvatar`, `removeAvatar`

## Design notes

- **Theme:** dark plum sidebar, white main area, yellow right panel, coral accents. Colours are tokens in `index.css` (`plum-800/900`, `sun-300/400`, `coral-400`, `blush`).
- **Tailwind v4:** use the canonical class names (`wrap-break-word`, `border-(--c)`, `bg-linear-to-br`).
- **Uploads:** an extension allow-list, a check that the file's first bytes match its type, a size cap (5 MB) and a per-item limit. Files are stored under random names.
- **Security:** every query and mutation checks ownership or course membership. Users outside a course get "not found". Files are served only to people who can see their parent item, and stored under random names, never the uploaded filename.
- **Logo:** put your image in `public/` and set `LOGO_SRC` at the top of `AppShell.tsx`.

## Deploy (Docker, Render, Neon)

One service serves everything: FastAPI answers `/graphql` and `/media`, and serves the built React app for all other addresses. One address means no CORS and the login cookie works as is.

1. **Database:** create a free Postgres on [Neon](https://neon.tech) and copy the connection string (use the `postgresql+psycopg://...?sslmode=require` form).
2. **Image:** the `Dockerfile` builds the frontend (Node), then runs the backend (Python). On start, `bootstrap_db.py` creates the tables on an empty database or runs `alembic upgrade head` on an existing one.
3. **Host:** on [Render](https://render.com) create a Web Service from the GitHub repo, runtime **Docker**, plan Free. Add these environment variables on its **Environment** page:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon string |
| `JWT_SECRET_KEY` | a new long random string |
| `GOOGLE_CLIENT_ID` | your client ID |
| `VITE_GOOGLE_CLIENT_ID` | the same client ID (read when the image is built) |
| `COOKIE_SECURE` | `1` |
| `PUBLIC_API_URL` | the live address, for example `https://your-app.onrender.com` |
| `GEMINI_API_KEY` | optional |
| `MEDIA_DIR` | `/srv/media` |

4. In the Google Cloud console add the live address to **Authorized JavaScript origins** for the sign-in client.
5. Run `SMOKE_TEST.md` on the live address.

To test the image on your computer: `docker build --build-arg VITE_GOOGLE_CLIENT_ID=<id> -t studysync .`, then run it with `--env-file docker.env` (no spaces around `=`, no quotes) and open `http://localhost:8000`. Add that address to the Google origins too.

**Free-tier limits:** Render sleeps after about 15 minutes idle (the next visit takes up to a minute), uploaded files (avatars and task files) are deleted on every restart or redeploy, and its outgoing mail ports are blocked, so reset emails need an HTTPS email service. Accounts and courses are safe because they live in Neon.

## Security built in

- Passwords: Argon2. Sessions: 15-minute access token plus a rotating, hashed, HttpOnly refresh cookie with reuse detection.
- Login is throttled (5 wrong tries per person and address, 20 per account, 30 per address, every 15 minutes) and sign-ups are limited to 10 per address per hour. The counters live in memory, so they reset on restart and cover one server only.
- In production the API hides unexpected error text, introspection, `/docs` and the GraphQL explorer, and refuses queries deeper than 12 levels, with more than 1000 fields, or requests above 12 MB.
- Every response carries `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, a Content-Security-Policy (report-only until you set `CSP_MODE=enforce`) and, on HTTPS, `Strict-Transport-Security`.

## Before you go live

- **Rotate secrets:** use a long random JWT secret. If one was ever pasted into chat, a screenshot or a commit, treat it as leaked and replace it. Same for the database password.
- **Keep secrets out of git:** `.gitignore` must cover `.env`, `docker.env`, `.venv`, `node_modules`, `media/` and `dist/`. If one was ever committed, remove it from the history, not just the latest commit.
- **HTTPS only.**
- **Uploads:** move `media/` to object storage or the database before relying on uploaded files, since free hosts lose the disk.
- **Database:** back up PostgreSQL. Turn off `--reload` in production.

## Known gaps and ideas

- No email reminders, no grading or feedback on submissions, no automated tests.
- Uploaded files are lost on free hosting restarts (see Deploy).
- Reset emails need SMTP or an HTTPS email service on the live site.
- Search covers tasks, posts, comments and assignments. It does not cover course names, events or file contents.
- Ideas: weekly class schedule with meeting times, study planner, spaced repetition, installable app (PWA).