from ariadne import make_executable_schema

from app import agenda, courses_api, files as files_api, focus, meetings, notifications, password_reset, profile_api, search, sharing_api, study, tasks_api
from app import schema as auth_api

schema = make_executable_schema(
    [auth_api.type_defs, courses_api.type_defs, profile_api.type_defs,
     sharing_api.type_defs, tasks_api.type_defs, files_api.type_defs, agenda.type_defs, focus.type_defs, notifications.type_defs, search.type_defs, study.type_defs, password_reset.type_defs, meetings.type_defs],
    auth_api.query, auth_api.mutation, auth_api.user_type,
    courses_api.query, courses_api.mutation, courses_api.date_scalar, courses_api.course_type,
    profile_api.mutation, profile_api.user_extra,
    sharing_api.query, sharing_api.mutation,
    tasks_api.query, tasks_api.mutation, tasks_api.task_type,
    files_api.query, files_api.mutation, files_api.post_type,
    agenda.query, agenda.mutation,
    focus.query, focus.mutation,
    notifications.query, notifications.mutation,
    search.query,
    study.query, study.mutation,
    password_reset.query, password_reset.mutation,
    meetings.query, meetings.mutation,
    convert_names_case=True,
)