<div align="center">

# minibrain

**Train, evaluate and serve models of any size on your own data.**<br>
On your own hardware or cloud, under your control.

[![CI](https://img.shields.io/github/actions/workflow/status/getminibrain/minibrain/ci.yml?branch=main&label=CI)](https://github.com/getminibrain/minibrain/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/getminibrain/minibrain?label=release)](https://github.com/getminibrain/minibrain/releases)
[![PyPI](https://img.shields.io/pypi/v/minibrain?label=PyPI)](https://pypi.org/project/minibrain/)
[![Python](https://img.shields.io/badge/python-3.12%20%7C%203.13-blue)](pyproject.toml)
[![Image](https://img.shields.io/badge/image-ghcr.io-blue?logo=docker&logoColor=white)](https://github.com/getminibrain/minibrain/pkgs/container/minibrain)
[![Signed](https://img.shields.io/badge/signed-Sigstore-blue)](https://getminibrain.com/docs/install/verify-release)
[![License](https://img.shields.io/github/license/getminibrain/minibrain)](LICENSE)

[Docs](https://getminibrain.com/docs) · [Install](https://getminibrain.com/docs/get-started/installation) · [Your first model](https://getminibrain.com/docs/get-started/first-model) ·
[API](https://getminibrain.com/docs/api/overview) · [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md)

</div>

---

minibrain turns your data into models you own. Point it at a dataset, score a prompt-only baseline, train only when
the numbers say it pays, and serve the winner on an OpenAI-compatible endpoint. Your data stays on your infrastructure.

- **Any size.** From a fast task model to a private frontier endpoint, on the base model that fits the job.
- **Eval first.** Every model starts as a scored baseline; each trained version is compared on the same held-out rows.
- **Private by default.** It runs on your infrastructure from signed releases, and fully air-gapped when you need it.
- **Yours to keep.** Weights, data, scores and logs stay on your infrastructure; export a model at any time.

## Quick start

```sh
curl -LsSf https://raw.githubusercontent.com/getminibrain/minibrain/main/install.sh | sh
minibrain serve
```

Open the setup link it prints, create the admin account, and you are at http://127.0.0.1:8000.

<details>
<summary>Other ways to run it</summary>

```sh
uvx --python 3.12 minibrain serve                     # straight from PyPI with uv
pip install minibrain && minibrain serve              # any Python 3.12 or 3.13

docker run --name minibrain -p 127.0.0.1:8000:8000 -v minibrain-data:/data \
  ghcr.io/getminibrain/minibrain                      # CPU

docker run -d --name minibrain --gpus all --shm-size 8g -p 127.0.0.1:8000:8000 -v minibrain-data:/data \
  ghcr.io/getminibrain/minibrain:cuda                 # NVIDIA GPUs
```

In Docker, `docker logs minibrain | grep setup` finds the setup link. Air-gapped installs, PyTorch backends,
compose, upgrades and signature checks are in the [install guide](https://getminibrain.com/docs/install/installer).

</details>

## How it works

| | Step | What happens |
|---|---|---|
| 1 | **Add data** | Upload CSV or JSONL, or connect Postgres. Held-out rows are set aside for scoring. |
| 2 | **Add a model** | Pick a base model, a dataset and the output: labels, JSON or free text. |
| 3 | **Baseline** | Version 0, the base model plus instructions, is scored at once. |
| 4 | **Train** | One click. The new version is scored on the same rows: `+18 vs v0`. |
| 5 | **Deploy** | Promote the version that wins; the API name now routes to it. |
| 6 | **Improve** | Reviewed feedback and new data lead to the next version. |

Try it with the demo datasets under **Data › Add › Demo data** ([`demo_data/`](demo_data/README.md)).

## Call your model

Create a key on the model's **API keys** tab, then use any OpenAI client:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key="mb_...")
reply = client.chat.completions.create(
    model="support-triage",
    messages=[{"role": "user", "content": "I was charged twice"}],
)
print(reply.choices[0].message.content)
```

`support-triage` follows the live version; `support-triage@2` pins one. Structured output with `json_schema` is
supported ([structured output](https://getminibrain.com/docs/api/structured-output)).

## Scale out

One command runs everything on one machine. The same package adds machines as you grow:

| Command | Runs |
|---|---|
| `minibrain serve` | Main: UI, API, gateway, a job worker and one engine per base model |
| `minibrain worker --main http://main:8000 --pool gpu` | A GPU worker on another machine, pulling jobs from main |
| `minibrain gateway --main-url http://main:8000 --port 8100` | A standalone `/v1` gateway that keeps answering while main restarts |

Base models come from Hugging Face or a mirror, an S3 bucket, or a local folder; `MINIBRAIN_OFFLINE=1` turns off
every outbound call ([base models](https://getminibrain.com/docs/guides/models)). Metrics, traces and logs export to your own stack
([observability](https://getminibrain.com/docs/observability/metrics)).

## Documentation

| | |
|---|---|
| [Get started](https://getminibrain.com/docs) | What minibrain is, installation and your first model |
| [Install and run](https://getminibrain.com/docs/install/installer) | Every install path, GPUs, configuration, machines, upgrades, verifying a release |
| [Guides](https://getminibrain.com/docs/guides/data) | Data, base models, training, evaluation and deployments |
| [API](https://getminibrain.com/docs/api/overview) | The OpenAI-compatible `/v1` API: chat, streaming, structured output, tool calling |
| [Security](https://getminibrain.com/docs/security/accounts) | Sign-in and single sign-on, policies, audit log, encryption at rest, supply chain |
| [Observability](https://getminibrain.com/docs/observability/metrics) | Prometheus, OpenTelemetry and JSON logs |
| [Reference](https://getminibrain.com/docs/reference/architecture) | Architecture, how serving works, the CLI |
| [Roadmap](ROADMAP.md) | Where minibrain is going |

## Develop

Needs [uv](https://docs.astral.sh/uv/), Node with pnpm, and [mise](https://mise.jdx.dev).

```sh
mise run setup    # install Python and web dependencies
mise run dev      # API and worker on :8000, UI with hot reload on :5173
mise run check    # tests, ruff, pyright, biome, tsc
mise run build    # wheel with the built UI inside
mise run e2e      # the core journey in a browser, with fake serving and jobs (pnpm --dir web e2e)
```

`mise run setup-link` prints a fresh link to create the first admin; `mise run api-types` regenerates the TypeScript
client after API changes.

## License

[Apache-2.0](LICENSE)
