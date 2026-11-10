"""Write finished files into place, so a half-written file is never left where one is read."""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path

# A file still being written carries this prefix. Anything listing a folder skips it.
TEMP_PREFIX = "_tmp-"
SWAP_TRIES = 10
SWAP_WAIT = 0.3


def fingerprint(text: str) -> str:
    """The short hash a plan's text is known by. The editor uses it to tell whether a draft still matches the file."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def temp_beside(path: Path) -> Path:
    """The scratch name a file is written under before it is swapped in."""
    return path.with_name(f"{TEMP_PREFIX}{path.name}")


def replace(tmp: Path, path: Path) -> None:
    """Move a finished file into place. A viewer holding the old file can block the swap for a moment."""
    for _attempt in range(SWAP_TRIES):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(SWAP_WAIT)
    os.replace(tmp, path)


def save_text(path: Path, text: str) -> None:
    """Write text with LF line endings, making the folder if it is missing."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = temp_beside(path)
    tmp.write_text(text, encoding="utf-8", newline="\n")
    replace(tmp, path)


def save_image(img, path: Path) -> None:
    """Write an image. The format follows the file name."""
    tmp = temp_beside(path)
    img.save(tmp, optimize=True)
    replace(tmp, path)
