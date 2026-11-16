from fastapi import HTTPException, Request
from fastapi.routing import APIRoute

SMALLEST_ID = -(2**63)
LARGEST_ID = 2**63 - 1


def out_of_range(text: str) -> bool:
    try:
        value = int(text)
    except ValueError:
        return False
    return not SMALLEST_ID <= value <= LARGEST_ID


def ids_in_range(request: Request) -> None:
    route = request.scope.get("route")
    if not isinstance(route, APIRoute):
        return
    for field in route.dependant.path_params:
        if field.field_info.annotation is not int:
            continue
        text = request.path_params.get(field.alias)
        if isinstance(text, str) and out_of_range(text):
            raise HTTPException(status_code=404, detail="Not found")
