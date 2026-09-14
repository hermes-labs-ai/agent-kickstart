# Contributing to Agent Kickstart

Thank you for your interest in contributing to Agent Kickstart.

## Reporting Bugs

- Search [existing issues](https://github.com/hermes-labs-ai/agent-kickstart/issues) first to avoid duplicates.
- Open a new issue with a clear title and description.
- Include steps to reproduce, expected behavior, and actual behavior.
- Do not include your private portrait, onboarding notes, or session content — see [SECURITY.md](SECURITY.md).

## Submitting Pull Requests

1. Fork the repository.
2. Create a feature branch from `main` (`git checkout -b my-feature`).
3. Make your changes with clear, focused commits.
4. Add or update tests for any new behavior — see the coverage areas in [DEVELOPMENT.md](DEVELOPMENT.md).
5. Run the test suite before submitting:
   ```sh
   bash tests/run-tests.sh
   node agent-kickstart/bin/kickstart-state.mjs doctor
   ```
6. Open a pull request against `main` with a clear description of the change.

## Code Style

- Python 3.9+; no third-party runtime dependencies.
- Lint with the rules pinned in `pyproject.toml`:
  ```sh
  ruff check src
  ```
- The state engine (`agent-kickstart/bin/kickstart-state.mjs`) is plain Node.js with no dependencies.

## Design constraint

Per [DEVELOPMENT.md](DEVELOPMENT.md): keep ordinary language the primary interface. New slash
commands, visible scoring, global configuration, autonomous external actions, or opaque
personality labels work against the product and are likely to be declined for that reason
alone, independent of code quality.

## Development Setup

```sh
git clone https://github.com/hermes-labs-ai/agent-kickstart.git
cd agent-kickstart
pip install -e .
```

For the JavaScript/installer route, see the "Python installation" and "If you already
downloaded the repository" sections of the [README](README.md).

## Questions?

Open an [issue](https://github.com/hermes-labs-ai/agent-kickstart/issues).
