---
title: GPUs
description: Install the PyTorch build that matches your GPU, and see how minibrain picks the device it trains and serves on.
sidebar:
  order: 3
---

minibrain trains and serves with PyTorch, so the torch build you install decides which GPU it can use. Production runs
on Linux with NVIDIA GPUs; AMD and Intel GPUs work through their own builds, Apple silicon suits development, and a CPU
handles the smallest models.

## What a plain install gets

Without any setting, uv and pip take torch from PyPI:

| Platform | torch from PyPI |
|---|---|
| Linux, x86_64 and aarch64 | CUDA 13.2 build, about 3 GB to download. Runs on CPU when there is no GPU |
| macOS, Apple silicon | Metal (MPS) build |
| Windows | CPU only |

The [installer](installer.md) sets `UV_TORCH_BACKEND=auto` on Linux, so it picks the build from the installed driver.

## Choose another build

Set `UV_TORCH_BACKEND`, or pass `--torch-backend`, with `uvx`, `uv tool install` or `uv pip install`:

| Hardware | `UV_TORCH_BACKEND` |
|---|---|
| NVIDIA, picked from the installed driver | `auto` |
| NVIDIA, CUDA 13.2 | `cu132` |
| AMD, ROCm | `rocm7.2` |
| Intel GPU | `xpu` |
| No GPU (small download) | `cpu` |
| Apple silicon | Leave it unset |

```sh
UV_TORCH_BACKEND=auto uv tool install --python 3.12 minibrain
uvx --python 3.12 --torch-backend cpu minibrain serve
```

- uv marks `--torch-backend` as experimental.
- `auto` reads the installed GPU driver. On a machine without the GPU, such as a build host, set
  `UV_CUDA_DRIVER_VERSION` (NVIDIA) or `UV_AMD_GPU_ARCHITECTURE` (AMD) so `auto` knows what to pick; otherwise it falls
  back to the CPU build.
- Each backend has its own set of torch versions, so ROCm may get an older torch than CUDA.

With pip, install torch from the PyTorch index first, then minibrain:

```sh
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install minibrain
```

## How minibrain picks a device

Training and serving use the best device PyTorch has, in this order: CUDA (NVIDIA, or AMD through ROCm), Intel XPU,
the Apple GPU (MPS), then the CPU.

| Device | Trains in |
|---|---|
| CUDA, XPU | bf16 where the GPU supports it, fp16 otherwise |
| Apple GPU, CPU | fp32 |

To force a device for training, set `MINIBRAIN_TRAIN_DEVICE` to `cuda`, `xpu`, `mps` or `cpu`. A forced device has
no fallback.

## Engines and jobs on one machine

On a machine with NVIDIA GPUs, minibrain gives every engine and every training, scoring, judging or export job its
own GPU, or its own share of one, so they never load onto the same memory:

- An engine or job takes an idle GPU first. When none is idle it shares the GPU with the most room, if its model
  fits in what is left. minibrain counts 90% of each GPU's memory as usable.
- An engine takes the memory its model needs to serve plus room for its KV cache, never the whole GPU, so a
  training run can share the GPU of a live model. SGLang starts with `--mem-fraction-static` and vLLM with
  `--gpu-memory-utilization` sized to that share.
- A job takes what is left of its GPU and plans its training within it.
- Each one sees only its GPU through `CUDA_VISIBLE_DEVICES`. If the worker already runs with
  `CUDA_VISIBLE_DEVICES` set, such as a container given some of the host's GPUs, minibrain shares out only those.
- A job with no GPU left stays queued and its page says why, for example "Waiting for a GPU on gpu-01 with 38 GB
  free for training job 12: GPU 0 has 12 GB free (the engine for qwen3-8b holds 24 GB)". An engine with no GPU
  left waits the same way and starts when one frees up.

One engine uses one GPU. Apple silicon, the CPU, AMD and Intel GPUs run engines and jobs as before, without this
split. GPU sharing has not been run on an NVIDIA GPU yet.

## Apple silicon

Use a Mac for development and for trying minibrain on smaller models; the native install gets the Metal build of
torch. On the Apple GPU, training runs one example at a time with gradient accumulation, which keeps the Metal GPU from
hanging. If a run still fails or stops making steps there, the job starts again on the CPU and stays there.
`PYTORCH_ENABLE_MPS_FALLBACK=1` is set, so an operation MPS lacks runs on the CPU.

The `mlx` extra adds the MLX engine for serving on Apple silicon: `uv tool install --python 3.12 'minibrain[mlx]'`.
Docker on macOS has no GPU access, so a Mac in Docker runs on the CPU.

## CPU only

With no GPU, minibrain trains and serves on the CPU. Training on CPU suits models up to about 0.5B parameters. Install
the CPU build to save the CUDA download: `UV_TORCH_BACKEND=cpu`, or the CPU Docker image.

## NVIDIA in Docker

The CUDA image needs a Linux host with an NVIDIA driver that supports CUDA 13.2 (`nvidia-smi` shows CUDA Version 13.2
or higher) and the NVIDIA Container Toolkit. Run it with `--gpus all`: [Docker](docker.md).

## QLoRA and 8-bit optimisers

The `qlora` extra adds bitsandbytes, for QLoRA and 8-bit optimisers on CUDA, ROCm and Intel GPUs, on Linux and
Windows. The Docker images include it.

## SGLang and vLLM

Without them, engines serve with `transformers`. On Linux with NVIDIA or AMD GPUs you can serve with SGLang or vLLM
instead. Neither is part of any install above: each pins its own torch, so install it in its own virtual environment
and point minibrain at that environment's Python with `MINIBRAIN_SGLANG_PYTHON` or `MINIBRAIN_VLLM_PYTHON`. The vLLM
engine has not been run on a GPU yet. How engines are chosen: [How serving works](../reference/how-serving-works.md).
