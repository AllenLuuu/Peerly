import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import { HttpPeerlyApi } from "./api/peerly-api-client.js";
import { SocketPeerlyRealtimeClient } from "./realtime/peerly-realtime-client.js";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("找不到 Peerly 页面挂载节点");

createRoot(root).render(
  <StrictMode>
    <App api={new HttpPeerlyApi()} realtime={new SocketPeerlyRealtimeClient()} />
  </StrictMode>,
);
