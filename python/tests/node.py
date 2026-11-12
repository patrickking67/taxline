"""Skip or fail a test that needs Node, the same way the parity tests do."""

from __future__ import annotations

import os

import pytest


def require_node(why: str) -> None:
    """Fail when ``TAXLINE_PARITY_REQUIRED=1`` (CI sets it), otherwise skip."""
    message = f"Node and `npm ci` at the repo root are needed: {why}"
    if os.environ.get("TAXLINE_PARITY_REQUIRED") == "1":
        pytest.fail(message)
    pytest.skip(message)
