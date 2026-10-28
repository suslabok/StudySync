from ariadne import make_executable_schema

from app import courses_api, files as files_api, profile_api, sharing_api, tasks_api
from app import schema as auth_api

schema = make_executable_schema(
    [auth_api.type_defs, courses_api.type_defs, profile_api.type_defs,
     sharing_api.type_defs, tasks_api.type_defs, files_api.type_defs],
    auth_api.query, auth_api.mutation, auth_api.user_type,
    courses_api.query, courses_api.mutation, courses_api.date_scalar,
    profile_api.mutation, profile_api.user_extra,
    sharing_api.query, sharing_api.mutation,
    tasks_api.query, tasks_api.mutation, tasks_api.task_type,
    files_api.query, files_api.mutation,
    convert_names_case=True,
)