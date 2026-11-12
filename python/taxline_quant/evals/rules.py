"""Run the service's rules extractor over rendered documents.

The extractor is TypeScript (``service/src/extract``), the one the agent fleet
calls. This module writes the documents to a temporary file, runs
``service/eval/extract-corpus.ts`` with Node, and reads back what it extracted,
so the scores describe the code that ships and not a copy of it. The extractor
is deterministic and offline; no model API is involved.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Final

from .extractor import Prediction
from .recorded import predictions_from_json
from .render import RenderedDocument

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
SCRIPT: Final = REPO_ROOT / "service" / "eval" / "extract-corpus.ts"
TSX: Final = REPO_ROOT / "node_modules" / ".bin" / "tsx"


class ExtractorUnavailableError(RuntimeError):
    """Node or the installed TypeScript toolchain is missing."""


def rules_available() -> bool:
    return shutil.which("node") is not None and TSX.exists()


def run_rules_extractor(documents: Sequence[RenderedDocument]) -> tuple[Prediction, ...]:
    """Extract every document with the service's rules extractor."""
    if not rules_available():
        raise ExtractorUnavailableError(
            "Node and the repo's npm install are required: run `npm ci` at the repo root"
        )
    corpus = [{"docId": d.doc_id, "text": d.text} for d in documents]
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "corpus.json"
        path.write_text(json.dumps(corpus), encoding="utf-8")
        done = subprocess.run(
            [str(TSX), str(SCRIPT), str(path)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=300,
        )
    if done.returncode != 0:
        raise RuntimeError(f"extract-corpus.ts failed ({done.returncode}): {done.stderr.strip()}")
    return predictions_from_json(json.loads(done.stdout), "rules extractor")
