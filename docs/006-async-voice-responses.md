# Async Voice Responses

Status: product design
Last updated: 2026-05-05

## Purpose

Flight Deck chat should support asynchronous voice in both directions. The
important product bet is not realtime voice. It is making thoughtful async
conversation easier when the user is walking, driving, or away from the screen.

## User Model

The user can already leave a voice note. The agent should be able to respond
with text first, then attach a spoken version shortly after.

This preserves speed while making longer responses easier to consume.

## Message Flow

1. Agent posts the text response.
2. The text response is immediately available in chat.
3. A background process creates a text-to-speech audio version.
4. The audio attachment is added to the same message or clearly linked to it.
5. The user sees that the message now has a playable voice version.

The text response should not wait for audio generation.

## UX Rules

- Text is the canonical response.
- Audio is an attachment or alternate rendering of the same response.
- The UI should make pending audio generation visible without being noisy.
- When audio is ready, the user should be able to play it from the chat thread.
- The user should not have to open a separate audio inbox.

## Timing

Audio generation can be delayed by a few minutes.

This is acceptable because the chat model is asynchronous. The product should
optimize for reliable delivery and good playback rather than realtime latency.

## Storage And Record Model

The voice artifact should be linked to the chat message.

Suggested links:

- source: the chat message text response
- deliverable: the generated audio attachment, if represented as its own record
- reference: the task or thread that caused the response, when relevant

## Acceptance Criteria

- Agents can reply with text immediately.
- A generated voice version can appear later on the same message.
- The user can record voice notes and receive voice responses in the same chat
  flow.
- Failure to generate audio does not block or invalidate the text response.

