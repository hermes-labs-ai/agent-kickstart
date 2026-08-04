from __future__ import annotations

import argparse
import filecmp
import shlex
import shutil
import subprocess
import sys
from importlib.resources import as_file, files
from pathlib import Path
from typing import Optional


def asset_root():
    return files("agent_kickstart").joinpath("assets")


def asset_files(root: Path):
    return sorted(path for path in root.rglob("*") if path.is_file())


def require_runtime() -> None:
    missing = [name for name in ("claude", "node") if shutil.which(name) is None]
    if missing:
        raise RuntimeError(
            "Missing required command(s): " + ", ".join(missing) +
            ". Install or repair them, then run this command again."
        )


def start_command(target: Path, platform: Optional[str] = None) -> str:
    platform = sys.platform if platform is None else platform
    if platform.startswith("win"):
        quoted_target = str(target).replace("'", "''")
        return f"Set-Location -LiteralPath '{quoted_target}'; claude '/kickstart'"
    return f'cd -- {shlex.quote(str(target))} && claude "/kickstart"'


def install(target: Path) -> int:
    target = target.resolve()
    print(f"Installing Agent Kickstart inside: {target}")
    require_runtime()
    with as_file(asset_root()) as raw_assets:
        assets = Path(raw_assets)
        entries = [(source, target / source.relative_to(assets)) for source in asset_files(assets)]
        conflicts = [dest for source, dest in entries if dest.exists() and not filecmp.cmp(source, dest, shallow=False)]
        if conflicts:
            listing = "\n".join(f"  - {path.relative_to(target)}" for path in conflicts)
            raise RuntimeError(
                "Installation stopped before changing files because these paths already differ:\n"
                f"{listing}\nMove or review them, then retry; nothing was overwritten."
            )
        created = 0
        for source, dest in entries:
            if dest.exists():
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, dest)
            created += 1

    engine = target / "agent-kickstart/bin/kickstart-state.mjs"
    engine.chmod(engine.stat().st_mode | 0o100)
    for action in ("init", "doctor"):
        result = subprocess.run(
            ["node", str(engine), action], cwd=target, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    print(f"Agent Kickstart is ready. Added {created} missing project-local file(s).")
    print("Claude Code must be closed and reopened once so the project command loads — part of installation, not an error.")
    print()
    print("──────────────── COPY THIS ONE LINE ────────────────")
    print(start_command(target))
    print("────────────────────────────────────────────────────")
    print()
    print("Paste it into your terminal (type /exit first if you are inside Claude Code). The same line works any time you want to come back.")
    return 0


def uninstall(target: Path) -> int:
    target = target.resolve()
    print(f"Removing managed Agent Kickstart files from: {target}")
    removed = 0
    preserved = []
    with as_file(asset_root()) as raw_assets:
        assets = Path(raw_assets)
        for source in asset_files(assets):
            relative = source.relative_to(assets)
            if relative.parts[:2] in (("agent-kickstart", "state"), ("agent-kickstart", "creations")):
                continue
            dest = target / relative
            if not dest.exists():
                continue
            if filecmp.cmp(source, dest, shallow=False):
                dest.unlink()
                removed += 1
            else:
                preserved.append(relative)
    print(f"Removed {removed} unchanged managed file(s).")
    print("Your state and agent-kickstart/creations/ were preserved.")
    if preserved:
        print("Locally changed files were also preserved:")
        for path in preserved:
            print(f"  - {path}")
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="agent-kickstart")
    sub = result.add_subparsers(dest="command", required=True)
    for name in ("install", "uninstall"):
        command = sub.add_parser(name)
        command.add_argument("--target", type=Path, default=Path.cwd())
    return result


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        return install(args.target) if args.command == "install" else uninstall(args.target)
    except RuntimeError as error:
        print(f"Agent Kickstart could not complete {args.command}.", file=sys.stderr)
        print(f"What happened: {error}", file=sys.stderr)
        print("No existing user work was deleted or overwritten.", file=sys.stderr)
        return 1
