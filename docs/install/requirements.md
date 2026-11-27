---
title: Requirements
description: What a machine needs before you install minibrain, covering operating system, Python, accelerators, memory, disk and network access.
sidebar:
  order: 0
---

minibrain is one Python package. It runs on a laptop to try it, and in production on Linux machines with NVIDIA GPUs.
This page lists what a machine needs before you install; the other pages in this section have the commands.

## Operating system

| System | Native install | Docker |
|---|---|---|
| Linux, x86_64 or arm64, with glibc | Yes | Yes, with GPUs through the CUDA image |
| macOS on Apple silicon | Yes | CPU only: Docker on macOS has no GPU access |
| macOS on Intel | No: PyTorch has no builds for Intel Macs | The CPU image |
| Alpine and other musl distributions | No: PyTorch has no builds for them | Yes |
| Windows | With pip; not tested yet, and it gets the CPU build of PyTorch | Docker Desktop, or run the installer in WSL |

The images are built for linux/amd64 and linux/arm64. Each install path: [Installer](installer.md),
[Python and uv](python.md) and [Docker](docker.md).

## Python

- Python 3.12 or 3.13. The commands on these pages use 3.12, which the Docker image runs too.
- uv or pip. The installer installs uv when it is missing.
- No Node: the web UI is inside the package.
- With Docker you need none of these: the image carries Python and every library.

## Accelerators

minibrain trains and serves with PyTorch, on the best device PyTorch finds: an NVIDIA or AMD GPU, an Intel GPU, the
Apple GPU, then the CPU.

| Hardware | PyTorch build | Suits |
|---|---|---|
| NVIDIA GPU | CUDA 13.2, the build a plain install gets on Linux | Production |
| AMD GPU | ROCm (`UV_TORCH_BACKEND=rocm7.2`) | Training and serving |
| Intel GPU | `UV_TORCH_BACKEND=xpu` | Training and serving |
| Apple silicon | Metal (MPS), the build a native install gets on macOS | Development and smaller models |
| No GPU | CPU (`UV_TORCH_BACKEND=cpu`, or the CPU image) | The smallest models: training on CPU suits models up to about 0.5B parameters |

- In Docker, GPUs need a Linux host with an NVIDIA driver that supports CUDA 13.2 (`nvidia-smi` shows CUDA Version
  13.2 or higher) and the NVIDIA Container Toolkit.
- QLoRA and 8-bit optimisers need the `qlora` extra, on NVIDIA, AMD and Intel GPUs. The Docker images include it.
- Engines serve with `transformers` unless you add another engine: SGLang or vLLM on Linux with NVIDIA or AMD GPUs,
  MLX on Apple silicon (the `mlx` extra), llama.cpp for GGUF models (the `llamacpp` extra).

Builds, devices and engines in detail: [GPUs](gpus.md).

## Memory

How much memory a machine needs depends on the models you run on it. A model loads into GPU memory on NVIDIA, AMD and
Intel GPUs, into the GPU-usable unified memory on Apple silicon, and into RAM on a machine without a GPU.

- To serve a model, minibrain counts the size of its weights times 1.2, plus 0.5 GB. A machine fits the model when it
  has that much memory.
- **Discover** shows this for every model and format before you download anything: the memory to run it, the memory to
  train it and the pools that fit ([Base models](../guides/models.md#browse-the-catalogue)). The Deploy dialog shows
  each pool's fit, such as "Runs · 2.2 of 24 GB" or "Too small".
- A training run is planned to stay under 85% of the memory of the machine that trains it: the largest single GPU,
  the GPU-usable unified memory on Apple silicon, or RAM on a CPU. When no plan fits, the Train page says what the
  smallest plan needs and what the machine has ([Recipes and memory](../guides/training-recipes.md#memory-planning)).
- On a machine with NVIDIA GPUs, each engine and each job gets its own GPU, or its own share of one, and minibrain
  counts 90% of each GPU's memory as usable. One engine uses one GPU
  ([GPUs](gpus.md#engines-and-jobs-on-one-machine)).
- Quantized formats are smaller and serve only; training needs the full-precision format
  ([Formats](../guides/models.md#formats)).
- In Docker, give the container shared memory for PyTorch data loading with `--shm-size 8g`: Docker's default of 64 MB
  is too small.

## Disk

minibrain keeps its data in one home folder: `~/.minibrain`, the folder `MINIBRAIN_HOME` names, or the
`minibrain-data` volume in Docker ([Where data lives](data-folder.md)).

| What | Size |
|---|---|
| PyTorch, CUDA build on Linux | About 3 GB to download |
| CPU image | About 1.7 GB |
| CUDA image | About 7 GB |
| DuckDB extensions, on a native install | Tens of MB |
| A base model | Its download size, shown in **Discover**, and 1 GB more, free on the disk that holds model files |

- Datasets, adapters, job logs and training checkpoints add to the home folder as you work. **Infrastructure** ›
  **Storage** shows what uses the space.
- With artifacts in an S3-compatible bucket, base models and artifacts live in the bucket, and each machine keeps
  working copies of what it runs.
- Machines that join as workers keep working copies of the models they train and serve under their own home folder.
- Health warns when a disk under a home folder has less than 10 GB or 10% free.

## Network access

To install:

| Install | Reaches |
|---|---|
| Installer | GitHub for the script and the release files, astral.sh when it installs uv, then PyPI and the PyTorch index for the libraries |
| uv or pip | PyPI, and the PyTorch index (`download.pytorch.org`) for another PyTorch build |
| Docker | `ghcr.io` for the image, which carries every library |

While it runs, these connections follow the Network policy (Open, Allowlist or Offline) under **Settings** ›
**Security** ([Policies](../security/policies.md)):

- Hugging Face, or the mirror `MINIBRAIN_HF_ENDPOINT` names, to download a base model when you add it.
- An S3-compatible bucket you import a base model from.
- extensions.duckdb.org, when you run `minibrain extensions install` on a native install.
- minibrain's catalogue address, when an admin checks for a newer model catalogue.
- The buckets and databases you add as data sources.

Services an admin sets up are reached whatever the policy says: the artifact bucket, a SIEM, an OpenTelemetry
collector, Vault or AWS KMS, and the single sign-on provider
([What leaves your network](../security/network.md#what-leaves-your-network)).

Between machines, workers and engines reach main, and the bucket when artifacts live in one; gateways reach the
engines. Machines that join need no internet access. Ports and zones: [Add machines](machines.md#network) and
[Network and ports](../security/network.md).

People open the UI in a browser. Sign-in needs HTTPS anywhere but `localhost`, so put a TLS proxy in front of main
before others use it ([TLS](../security/network.md#tls)).

### Without internet access

`MINIBRAIN_OFFLINE=1` turns off every outbound call. You then carry three things into the network: minibrain itself
(the image, or the wheels), the model weights, and on a native install the DuckDB extensions. Base models are imported
from a folder on the server instead of downloaded, and the model catalogue is the one that ships with the release.
Steps: [Air-gapped installs](air-gapped.md).

## Production

One machine runs everything. A production install adds Postgres, an S3-compatible bucket, a TLS proxy and separate
machines for gateways and GPUs: [Production setup](production.md).
