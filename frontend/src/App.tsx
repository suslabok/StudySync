import { Route, Routes } from "react-router-dom";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import RequireAuth from "./auth/RequireAuth";
import ProfilePage from "./pages/ProfilePage";
import CoursePage from "./pages/CoursePages";
import CoursesPage from "./pages/CoursesPage";
import TasksPage from "./pages/Taskspage";
import CalendarPage from "./pages/CalendarPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route element={<RequireAuth />}>
  <Route path="/" element={<DashboardPage />} />
  <Route path="/profile" element={<ProfilePage />} />
  <Route path="/courses/:id" element={<CoursePage />} />
  <Route path="/courses" element={<CoursesPage />} />
  <Route path="/tasks" element={<TasksPage />} />
  <Route path="/calendar" element={<CalendarPage />} />
</Route>
    </Routes>
  );
}