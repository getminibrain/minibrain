# API internals (contributor notes)

Unpublished. What `docs/serving.md` said about the `/v1` request path that the user pages under `docs/api/` leave
out: engine internals, module-level behaviour, and gaps found while rewriting. Code: `minibrain/gateway/`
(`routes.py`, `chat.py`, `text.py`, `safety.py`, `schema.py`, `errors.py`), `minibrain/serve/sampling.py`,
`minibrain/serve/structured.py`, `minibrain/serve/dialects.py`.

## Request path

An inference request never touches the database.

| Step | Source |
|---|---|
| Key, scope, expiry | In-memory config snapshot (key hashes) |
| Route, version, adapter | Same snapshot |
| Engine replicas for the model | Same snapshot, refreshed from engine announcements |
| Replica choice | Per-gateway memory: in-flight counts, sticky map, health from 5 s checks |
| Request log, key last-used | Buffered, written in batches every ~2 s |

- Config is up to ~1 s stale: a revoked key stays valid for at most a second.
- Scale out: more gateway replicas behind HAProxy, Envoy or a cloud load balancer, then more engines. GPUs are the
  bottleneck long before gateways or the database.
- Very high log volume moves to ClickHouse or Parquet in object storage, or to sampling.

## Concurrency

`/v1/chat/completions` and `/v1/completions` are `async` handlers; `Generations` in `gateway/capacity.py` runs each
call's blocking work, and every chunk of a stream, on worker threads under its own `anyio.CapacityLimiter`, never the
shared default limiter (about 40 threads) that the UI, worker check-ins, lease renewals and long polls use.

- A call takes a slot for its whole life, stream included (`GenerationStream` gives it back after closing the stream,
  so an abandoned stream is still logged as 499). No slot free: 503 at once, OpenAI `error` with `code: overloaded`,
  `Retry-After: 5` (`BUSY_RETRY_SECONDS`), logged like any call. Slots: `MINIBRAIN_GATEWAY_CONCURRENCY`, default 64
  (`Settings.gateway_concurrency`), the same on main and standalone gateways.
- Engine start: the call sets `START_WAIT` (a context variable in `serve/engines.py`) to 5 s, so `EngineBackend.opened`
  stops waiting for a loading or fetching replica after 5 s and raises `EngineUnavailableError` with `retry_after` 10;
  the gateway answers 503 `detail` plus `Retry-After`. A replica that reports ready but cannot be reached still gets
  its own message after 30 s. Other callers (the Playground, Test on a base or a version) keep the 600 s window and
  stay on the default limiter.
- `/v1/models` and `/v1/feedback` are short and stay on the default limiter.

## Streaming per engine

`stream: true` sends `chat.completion.chunk` events as the engine generates them: `transformers` through a token
streamer, MLX through `stream_generate`, llama.cpp through its own stream, SGLang and vLLM by relaying their events,
and remote engines as newline-delimited JSON from `/generate`. The gateway splits each piece into `content`,
`reasoning_content` and `tool_calls` deltas as it goes (a tool call is sent whole once its closing tag arrives).

- A gateway fails over to another replica only before the first byte of a stream.
- The request log is written when the stream ends, with its tokens and status; a stream the caller closes is logged
  as 499 (`CLIENT_CLOSED`), an engine failure mid-stream as the error's status (503 for an engine that went away).
- Buffered (generated in full, then sent): `response_format`, a contract with a constraint (labels) or a JSON schema,
  and safety answer checks (`buffered()` in `chat.py`). A prompt-only safety check runs before streaming starts.

## Sampling per engine

A field left out is not sent, so the model's default applies: its `generation_config.json` on `transformers` and MLX
(greedy when it has none), the engine's own default on SGLang, vLLM and llama.cpp. A custom model answers at
temperature 0 unless the request sets one (`Sampling.or_greedy()`).

| Field | Range | SGLang, vLLM | llama.cpp | MLX | `transformers` |
|---|---|---|---|---|---|
| `max_tokens`, `max_completion_tokens` | 1 or more; unset: the context limit | Passed on | Passed on | Passed on | Passed on |
| `temperature` | 0 to 2 | Passed on | Passed on | `make_sampler` | `GenerationConfig` |
| `top_p` | above 0, up to 1 | Passed on | Passed on | `make_sampler` | `GenerationConfig` |
| `top_k` | 1 or more | Passed on | Passed on | `make_sampler` | `GenerationConfig` |
| `min_p` | 0 to 1 | Passed on | Passed on | `make_sampler` | `GenerationConfig` |
| `presence_penalty`, `frequency_penalty` | -2 to 2 | Passed on | Passed on | Logits processor | Logits processor |
| `repetition_penalty` | above 0, up to 2 | Passed on | `repeat_penalty` | `make_logits_processors` | `GenerationConfig` |
| `seed` | any integer | Passed on | Passed on | `mx.random.seed` | `torch.manual_seed` |
| `stop` | up to 4 texts | Passed on, after the model's stop tokens | Passed on | Checked as it decodes | `stop_strings` |

- An engine that cannot honour a field (an older `mlx-lm` without `top_k` or `min_p`, or a server that refuses one)
  raises `UnsupportedParameterError`; the gateway answers 400 with `code: unsupported_parameter` and the field in
  `param`, never silently ignoring it.
- Without `max_tokens` the answer runs to the end of the model's context (`max_position_embeddings`; MLX and
  `transformers` fall back to 4,096). llama.cpp loads with `n_ctx=4096` (`CONTEXT_TOKENS` in
  `serve/llamacpp_backend.py`), so prompt and answer share 4,096 tokens on GGUF models.

## Text completions per engine

Each engine takes its raw-prompt path: `transformers` tokenizes the text with the tokenizer's BOS token in front (when
it has one and the prompt lacks it), MLX encodes it with special tokens, llama.cpp passes it to `create_completion`,
and SGLang and vLLM get it on their own `/v1/completions`. Remote engines carry it as `prompt` on `/generate`. The
request log `kind` is `completion`.

## Structured output per engine

| Request | SGLang | llama.cpp | MLX, `transformers` |
|---|---|---|---|
| Classify model, no `response_format` or `text` | Held to the labels (EBNF grammar) | Held to the labels (GBNF grammar) | Held to the labels (token trie) |
| `json_object` | Constrained (schema `{"type": "object"}`) | Constrained (grammar from the schema) | Free, then checked |
| `json_schema` | Constrained (`response_format` passed on) | Constrained (grammar from the schema) | Constrained when the schema has a finite set of answers (enums, booleans, objects of them); otherwise free, then checked |

- If an engine refuses the label grammar, the gateway answers without it and logs a warning
  (`complete()` in `chat.py`), so a Classify answer is not guaranteed to be a label in that case.
- `pattern` is not run by the gateway's check (a caller's regular expression could stall the gateway); llama.cpp
  applies it while decoding.
- The 422 message names the engines: "only SGLang and llama.cpp engines constrain decoding, the others check the
  answer afterwards" (`UNCONSTRAINED` in `chat.py`).

## Tool-call formats

| Format | Read from | Families | SGLang parser | vLLM parser |
|---|---|---|---|---|
| `hermes` | `<tool_call>` JSON `</tool_call>` | Qwen 2.5 and 3, Hermes, SmolLM3 | `qwen25` | `hermes` |
| `llama3` | `{"name", "parameters"}` JSON, after `<|python_tag|>` or alone; `;` between calls | Llama 3.1, 3.2, 3.3 | `llama3` | `llama3_json` |
| `mistral` | `[TOOL_CALLS]` and a JSON list | Mistral 7B v0.3, Nemo, Small | `mistral` | `mistral` |
| `harmony` | the `commentary to=functions.<name>` channel | gpt-oss | `gpt-oss` | `openai` |

- The format comes from the base model's own chat template (`chat_template.jinja`, `tokenizer_config.json`, or the
  GGUF metadata), read once per weights hash.
- The template renders the tools: `transformers`, MLX and llama.cpp pass `tools` to the tokenizer's chat template
  (llama.cpp through the same Jinja renderer as `transformers`) and read the calls back from the raw answer; SGLang
  and vLLM start with the matching `--tool-call-parser` and get `tools` as they are.
- `required` and a named function prefill the answer with the format's call opening (`<tool_call>` plus the name
  for Qwen), so the model can only complete a call. `none` renders no tools.

## Reasoning detection

| Style | Detected from the template | Families | `none` | `low`, `medium`, `high` | Read from |
|---|---|---|---|---|---|
| Toggle | `enable_thinking` | Qwen3 (not the 2507 Instruct models), GLM-4.5, SmolLM3 | Thinking off | Thinking on | `<think>` … `</think>` |
| Effort | `reasoning_effort` | gpt-oss | 400 | The effort | the harmony `analysis` channel |
| Always | `<think>` opened by the generation prompt | DeepSeek-R1 and its distills, Qwen3 Thinking 2507 | 400 | 400 | up to `</think>` |
| None | none of these | everything else | Accepted, changes nothing | 400 | |

- The default stays off for custom models and the catalogue's Qwen3 bases (`enable_thinking: false` in their
  template settings); a base imported without that setting follows its own template's default.
- `transformers`, MLX and llama.cpp pass the setting to the chat template and split the answer; SGLang and vLLM get
  `chat_template_kwargs` (and `reasoning_effort` for gpt-oss) and start with `--reasoning-parser` (`qwen3`,
  `deepseek-r1` or `gpt-oss` on SGLang; `qwen3`, `deepseek_r1` or `openai_gptoss` on vLLM).

## Safety model internals

| Guard | Detected from | Prompt | Categories |
|---|---|---|---|
| Llama Guard 3 (1B, 8B) | `llama-guard` in the repo or name | its chat template, roles merged to alternate | `S1` to `S14`, named |
| ShieldGemma (2B, 9B) | `shieldgemma` | its template with each of four policies as `guideline` | the policy that answered Yes |
| Qwen3Guard Gen (0.6B, 4B, 8B) | `qwen3guard` | its template (request or answer moderation) | its own; Controversial passes |
| gpt-oss-safeguard (20B, 120B) | `gpt-oss-safeguard` | a written policy as the system message, low effort | the category in its JSON answer |

- The guard runs greedily through the same engines as any base, and its engine starts with the configuration when it
  is set.
- Playground calls are audited with the person as actor. Changes to the settings are audited as `settings.safety` and
  `model.safety`.
- The UI for choosing a safety model is hidden for v1 (commit 03f70be9): `InstallSafety` and `ModelSafety` in
  `web/src/components/SafetySettings.tsx` are not rendered anywhere. The old docs placed them under Settings, General
  and the model's Deployments page. Today they are set only through `PUT /api/settings/safety` (admin) and
  `PUT /api/models/{name}/safety` (builder, `mode` `inherit`, `none` or `model`); the model Overview shows the result.

## Gaps found while writing the API pages

- 401, 403, 409 and 503 on `/v1` answer FastAPI's `{"detail": "..."}`, not an OpenAI `error` object (they are
  `HTTPException`s in `routes.py` and `chat.py`), except the busy 503, which is an `error`. The pages document this
  as it is.
- Validation errors on `POST /v1/feedback` are FastAPI's default 422 with a `detail` list: `/v1/feedback` is not in
  `CHAT_PATHS` in `gateway/errors.py`.
- A `reasoning_effort` refused because the model has a labels or JSON contract uses `code: invalid_value`; every
  other `reasoning_effort` refusal uses `unsupported_value` (`reasoning_of()` in `chat.py`).
- The feedback 422 for a missing `input` still says "turn it on under Deployments, {model}"; the switch now lives on
  the model's Settings tab (`missing_input()` in `minibrain/data/feedback.py`).
