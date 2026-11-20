---
title: Base models
description: Pick an open model from the catalogue, or import one, to build custom models on.
sidebar:
  order: 2
---

A base model is the open model a custom model is built on: its weights, tokenizer and chat template. minibrain lists a
reviewed catalogue under **Discover**, downloads the format you pick, and imports models from Hugging Face, an
S3-compatible bucket or a folder on the server. Models of any size run, from a few billion parameters to mixtures of
experts across several GPUs.

## Browse the catalogue

**Discover** lists instruct and chat models from approved publishers (Qwen, Google, Meta, Mistral AI, Microsoft, IBM,
NVIDIA, DeepSeek, OpenAI's gpt-oss, Allen AI, Hugging Face's SmolLM and Z.ai's GLM), with reviewed licences,
architectures minibrain's engines serve and safetensors weights.

- Each row shows parameters, context length, formats, the memory to run and to train it, the download size and the
  licence. Columns can be shown or hidden.
- Sort by **Recommended** (for your machines), **Most popular**, **Newest**, size or name. Filter with **Fits your
  compute**, **Latest generation only**, and by task, size, format, publisher, commercial use, licence and access.
- A row opens the model's page: its details, each format with the memory it needs and the pools that run and train
  it, and its licence. **Add model** on a format starts a custom model on it.
- Tick up to 6 models and click **Compare** to see them side by side; the page's link can be shared.
- Older generations stay listed; the **Newer version** column names the model that replaces them.
- GLM-4.5 and 4.6 are hybrid reasoning models; their thinking stays off unless a request asks for it
  ([Reasoning](../api/reasoning.md)).

| Size | Parameters |
|---|---|
| S | Up to 4B |
| M | 7B to 14B |
| L | 24B to 35B, or a small mixture of experts |
| XL | 70B and more; needs a machine with two or more GPUs |

The catalogue ships with each release. An admin checks for a newer one under Settings › General › Model catalogue
(**Check for updates**, or **Check every day**). The update reads minibrain's own catalogue address
(`MINIBRAIN_CATALOG_URL`), not Hugging Face.

## Formats

| Format | Example | Use |
|---|---|---|
| Full precision | Full precision · BF16 | Trains and serves |
| Quantized | Quantized · Q8_0, Quantized · FP8 | Serves only: smaller and faster, slightly less accurate |

Quantized formats, GGUF included, cannot be fine-tuned. A model built on one gets prompt-only versions, and **Train**
says why; to train, build on the full-precision format. GGUF formats serve on llama.cpp.

## Download a catalogue model

1. In **Models**, click **Add model**, then **Base**. The **Catalogue** tab puts the models that suit your machines
   first; **Fits your compute** and **Trains on your compute** narrow it. **Add model** in Discover opens the same page.
2. Pick a **Format**: keep full precision to train.
3. Under **Licence**, tick **I accept the … for this install**. A base already on the install shows its licence as
   already accepted.
4. Fill in **Dataset**, **Output** and **Name** ([Your first model](../get-started/first-model.md) walks through them)
   and click **Create model**. The base downloads in the background, and v0 is scored once it is here.

Downloads are pinned to one repository revision, every file gets a SHA-256, and a download stopped by a full disk
resumes from the files already written. A model needs its download size free on the disk that holds model files.
Base model files are kept where Settings › Storage keeps artifacts ([Where data lives](../install/data-folder.md)).

:::note
A gated model shows **Needs access from the publisher**. Accept its licence on the publisher's page, set `HF_TOKEN`
on the minibrain server and restart it.
:::

## Import a model

In **Add model › Base**, open **Your imports** (or paste a path or id into the search) and pick the **Source**:

| Source | Enter | Notes |
|---|---|---|
| Hugging Face | A model id or link, such as `Qwen/Qwen3-1.7B` | Downloaded at a fixed revision. `MINIBRAIN_HF_ENDPOINT` (or `HF_ENDPOINT`) points at a mirror |
| S3 or bucket | An `s3://` path to a folder of model files | Read with a connection from Settings › Connections, or the server's `AWS_*` credentials. A path under `MINIBRAIN_MODELS_S3_URL` works too; `AWS_ENDPOINT_URL_S3` sets a non-AWS store |
| Server folder | An absolute path on the machine running minibrain | Not a path on your own computer |

minibrain reads and checks the files before copying anything, and shows the name, size, format, licence and the pools
that run it. Click **Import and use**. The files are copied in; the original stays as it was.

- The folder must be in Hugging Face format: `config.json` for a causal language model, the tokenizer files and
  `.safetensors` weights, sharded or not, with every shard present.
- Pickle weights (`.bin`, `.pt`, `.pth`, `.pkl`, `.ckpt`) are refused: they can run code when loaded.
- An import whose revision and files match a catalogue format is checked against the catalogue's checksums and takes
  its details. Anything else imports as not verified.
- A Hugging Face model that is not in the catalogue can be looked up (**Look it up**) and added to Discover, but only
  when an admin sets the Model sources policy to Any. The default, Approved publishers, keeps everyone on the
  catalogue.

## Licences and policies

Each catalogue model shows its licence and whether commercial use is allowed, allowed with conditions, not allowed or
not reviewed. An import reads its licence from its README.

Admins control downloads under Settings › Security ([Policies](../security/policies.md)): the Model sources policy
(approved publishers, any, or imports only), the Licences policy (only selected reviewed licences by default) and the
Network policy.

## After it is on the install

- The base appears under **Models** with its formats. Try it in the **Playground**, or deploy it by itself
  ([Deployments](deployments.md)).
- **View files** on its page lists each file with its SHA-256. An admin can **Verify files** there, and repair,
  re-import or point the model at a new location when files are damaged or moved.
- An admin can delete a base with its files. The dialog offers to delete the models built on it too, and asks to
  undeploy live ones and cancel running jobs first.
- To move a custom model to another base: [Train on a new base](training.md#train-on-a-new-base).
