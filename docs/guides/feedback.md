---
title: Feedback
description: Rate and correct a model's answers in the Playground or from an app, review them on the Feedback page, and train the next version with the accepted ones.
sidebar:
  order: 7
---

Feedback is how a model gets better on the answers it gets wrong. People mark answers right or wrong, in the
Playground or from your app; a reviewer accepts, edits or rejects each one; and the accepted answers join the data of
the model's next version. Feedback is collected for custom models, not for base models.

| Step | Where | Who |
|---|---|---|
| Rate or correct an answer | **Playground**, or `POST /v1/feedback` from an app | Any role; an API key that covers the model |
| Review it | **Feedback** in the sidebar | Builder |
| Save a test example | **Playground**, or the model's **Evaluation** tab | Builder |
| Train with accepted feedback | The model's **Train** page | Builder |

## Rate or correct an answer in the Playground

Open **Playground** in the sidebar and pick a custom model, or click **Use** › **Playground** in the model's header.
Under each answer:

- The thumbs-up (**Right answer**) and thumbs-down (**Wrong answer**) rate it.
- **Correct it** opens a **Right answer** field: a list of the model's labels for a classifier, a text field
  otherwise. Type or pick the answer and click **Send correction**. A correction counts as a thumbs-down.

A notice confirms it, such as "Correction sent for review", and the feedback waits on the Feedback page. Rating the
same answer again replaces the feedback that still waits for review.

## Send feedback from an app

Apps send the same ratings and corrections with `POST /v1/feedback`, using the `id` of the answer they received:
[Send feedback on an answer](../api/chat-completions.md#send-feedback-on-an-answer). The model's **Use** ›
**API Connect** dialog has a ready call under "Rate answers from your app; corrections become training data".

- The app sends the user's message as `input`, unless the model keeps request inputs and answers. That switch is
  **Keep request inputs and answers** under **Request content** on the model's **Settings** tab
  ([Request logs](../security/policies.md#request-logs)).
- **Monitoring** › **Requests** marks rated requests in its **Feedback** column, and a request's details list its
  feedback, with **Open review** for Builders.
- Through a standalone gateway, feedback sent while main is down gets a 503 and is not stored: send it again.

## Review feedback

**Feedback** lists what came in, with the tabs **To review**, **Accepted**, **Rejected** and **All**. Search the
inputs, answers and comments, or filter by **Model** and **Assigned to**. Each row shows the **Input**, the
**Model's answer** and the **Suggested answer**, with the words that differ marked.

**To review** puts first what needs a person most:

| Status note | Means |
|---|---|
| People disagree | Feedback on the same input points to different answers |
| No right answer given | The answer was marked wrong without a correction |

Click a row, or **Review next**, to open **Review feedback**. It shows the input, the model's answer with
**Marked right** or **Marked wrong**, the suggested answer, the sender's comment, who sent it and which version
answered, and other feedback on the same input.

| Action | Key | Does |
|---|---|---|
| **Accept** | A | Takes the suggested answer as the right one. With no suggested answer, use **Edit answer** |
| **Edit answer** | E | Opens **Right answer**, with **Pick a known answer** for a model that answers with labels. **Accept edited answer** saves it |
| **Reject** | R | Keeps the feedback out of the training data |
| **Skip** | S | Leaves it to review and opens the next one |
| **Previous** | K | Goes back one |

The suggested answer is the correction when there is one, or the model's own answer when it was marked right. After
a decision the next item opens, and a counter says how many are left. Esc returns to the list. An item on the
**Accepted** or **Rejected** tab can be opened and decided again.

### Share the work

**Assign to me** on an item puts your name on it, and **Unassign** takes it off. In the list, **Assigned to** filters
by **Me** or **No one**, and the column picker adds an **Assigned to** column. Assignment only says who is looking at
an item: anyone with the Builder role can still review it.

Accepting, editing, rejecting and assigning are recorded in the [audit log](../security/audit.md) and on the model's
**Activity** tab.

## Save a test example

A test example is a conversation with the answer it should get, kept for scoring instead of training. Use one for an
answer the model must keep getting right.

1. In the Playground, click **Save as test example** under an answer. The **…** menu in the page header saves the
   whole chat the same way.
2. Check the **Expected answer**. It starts as the model's answer: fix it if the model got it wrong. For a model
   that answers with labels, pick the right label.
3. Click **Save test example**.

It joins the held-out rows when the next version starts, so that version is scored on it and never trains on it.
Only conversations of plain messages can be saved, without tool calls. The model's **Evaluation** tab lists test
examples under **What it's tested on**, where **Add test example** adds one by hand and each row can be removed
([Test examples](evaluation.md#test-examples)).

## Train the next version

Accepted feedback is added to the data of every run you start afterwards.

1. On **Feedback**, a line per model counts what no version has trained on yet, such as "Support triage: 12 accepted
   answers since v1", with a **Train v2** button. **Train** in the model's header opens the same page.
2. On the Train page, the **Data** row says how much the run adds: "This run adds 12 accepted feedback rows to" the
   dataset version you picked.
3. Start the run as usual ([Train a version](training.md#start-a-run)).

- An accepted answer for an input the dataset already has replaces that row's answer. The count leaves out accepted
  answers the dataset already agrees with.
- When several accepted answers share an input, the one reviewed last is used.
- The new version is scored on the held-out rows, test examples included, and compared with the live one. Deploy it
  when it meets the [deploy rule](evaluation.md#the-deploy-rule).

The model's **Overview** shows **Feedback waiting** under **Current setup**, with how many items are to review and
how many are accepted.
