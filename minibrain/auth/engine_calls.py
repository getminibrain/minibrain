import hashlib
import hmac

from minibrain.auth.join_tokens import bearer

PURPOSE = "minibrain engine calls"
REFUSED = "this engine answers only gateways that hold main's gateway token"


def call_token(gateway_token: str, pool: str) -> str:
    return hmac.new(gateway_token.encode(), f"{PURPOSE}/{pool}".encode(), hashlib.sha256).hexdigest()


def call_headers(gateway_token: str, pool: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {call_token(gateway_token, pool)}"}


def presents(authorization: str, expected: str) -> bool:
    return hmac.compare_digest(bearer(authorization).encode(), expected.encode())
