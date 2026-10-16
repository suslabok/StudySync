from ariadne import make_executable_schema

from app import courses_api
from app import schema as auth_api

schema = make_executable_schema(
    [auth_api.type_defs, courses_api.type_defs],
    auth_api.query, auth_api.mutation, auth_api.user_type,
    courses_api.query, courses_api.mutation, courses_api.date_scalar,
    convert_names_case=True,
)