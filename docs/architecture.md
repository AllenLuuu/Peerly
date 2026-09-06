# Architecture

Peerly has three logical layers:

1. The web client renders collaboration state and communicates only with the Peerly server.
2. The Peerly server owns public identity, membership, conversation, message, authorization, and routing data.
3. The agent runtime owns agent execution and private runtime sessions. For the local MVP it is a TypeScript module called directly by its host, and it is the only layer allowed to depend on Pi.

## Package boundaries

```text
web ----------> contracts <---------- server
                                        |
                                        v
runtime-cli --------------------> agent-runtime
                                        |
                                        v
                                  agent-protocol
```

`@peerly/agent-protocol` contains the Runtime's public interface, schemas, and types. It must not export Pi types. `@peerly/agent-runtime` implements that interface and hides storage and, later, Pi integration. `@peerly/contracts` is reserved for browser/server contracts. `@peerly/shared` contains only utilities without domain ownership.

The server and CLI must not import Runtime implementation internals. If process isolation is needed later, another adapter can implement the same public interface over a remote transport without changing collaboration-domain code.

## Data ownership

The Peerly server will persist user-visible chat messages as JSON/JSONL. The runtime will later persist private Pi session state separately. Runtime output becomes a public message only after the server validates and persists it.

## Deferred infrastructure

The MVP does not use Docker, Redis, a server database, a message broker, or multiple organizations. Repository and protocol boundaries preserve a migration path without introducing those systems now.
