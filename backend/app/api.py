from ariadne import make_executable_schema

from app import courses_api, profile_api
from app import schema as auth_api

schema = make_executable_schema(
    [auth_api.type_defs, courses_api.type_defs, profile_api.type_defs],
    auth_api.query, auth_api.mutation, auth_api.user_type,
    courses_api.query, courses_api.mutation, courses_api.date_scalar,
    profile_api.mutation, profile_api.user_extra,
    convert_names_case=True,
)