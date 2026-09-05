# Architecture

Peerly has three independently deployable layers:

1. The web client renders collaboration state and communicates only with the Peerly server.
2. The Peerly server owns public identity, membership, conversation, message, authorization, and routing data.
3. The agent runtime owns agent execution and private runtime sessions. It communicates with the server through `@peerly/agent-protocol` and is the only layer allowed to depend on Pi.

## Package boundaries

```text
web ----------> contracts <---------- server
                                        |
runtime-cli --> agent-protocol <--------+
                    ^                   |
                    |                   |
               agent-runtime -----------+
```

`@peerly/agent-protocol` contains transport-facing schemas and types. It must not export Pi types. `@peerly/contracts` is reserved for browser/server contracts. `@peerly/shared` contains only utilities without domain ownership.

## Data ownership

The Peerly server will persist user-visible chat messages as JSON/JSONL. The runtime will later persist private Pi session state separately. Runtime output becomes a public message only after the server validates and persists it.

## Deferred infrastructure

The MVP does not use Docker, Redis, a server database, a message broker, or multiple organizations. Repository and protocol boundaries preserve a migration path without introducing those systems now.
