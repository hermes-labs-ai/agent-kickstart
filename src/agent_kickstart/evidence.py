"""Shared Hermes Reliability Lab result envelope.

One small, stable shape so a reliability tool can report what it did, what it
found, and whether anything actually changed on disk. It is deliberately not a
framework: build a dict, print it as JSON, done.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ENVELOPE = "hermes.reliability-lab.result/1"

#: Ordered worst-last so the overall status is the worst finding present.
STATUS_ORDER = ("pass", "warn", "unknown", "fail")


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def input_hash(value: Any) -> str:
    digest = hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def finding(identifier: str, severity: str, summary: str, detail: Optional[str] = None,
            path: Optional[str] = None) -> dict:
    if severity not in STATUS_ORDER:
        raise ValueError(f"unknown severity: {severity}")
    result = {"id": identifier, "severity": severity, "summary": summary}
    if detail is not None:
        result["detail"] = detail
    if path is not None:
        result["path"] = path
    return result


def worst_status(findings) -> str:
    status = "pass"
    for item in findings:
        if STATUS_ORDER.index(item["severity"]) > STATUS_ORDER.index(status):
            status = item["severity"]
    return status


def _git(start: Path, *arguments: str):
    try:
        return subprocess.run(
            ["git", "-C", str(start), *arguments],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5,
            env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
        )
    except (OSError, subprocess.SubprocessError):
        return None


def git_sha(start: Path) -> Optional[str]:
    """Best-effort commit of the checkout the tool is running from, or None.

    A tree with uncommitted changes gets a "-dirty" suffix: the named commit
    does not describe the code that produced the record, and a reader following
    the SHA would otherwise be looking at the wrong source.
    """
    head = _git(start, "rev-parse", "HEAD")
    if head is None or head.returncode or not head.stdout.strip():
        return None
    sha = head.stdout.strip()

    status = _git(start, "status", "--porcelain")
    if status is None or status.returncode:
        return sha
    return f"{sha}-dirty" if status.stdout.strip() else sha


def envelope(tool: str, tool_version: str, command: str, mode: str, findings,
             inputs: Any, exit_code: int, data: Any = None,
             sha: Optional[str] = None, now: Optional[datetime] = None) -> dict:
    if mode not in ("preview", "executed"):
        raise ValueError(f"unknown mode: {mode}")
    findings = list(findings)
    moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return {
        "envelope": ENVELOPE,
        "tool": tool,
        "toolVersion": tool_version,
        "command": command,
        "mode": mode,
        "status": worst_status(findings),
        "inputHash": input_hash(inputs),
        "findings": findings,
        "exitCode": exit_code,
        "timestamp": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "gitSha": sha,
        "data": data,
    }
