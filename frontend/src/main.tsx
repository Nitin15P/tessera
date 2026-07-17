import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { connect } from "./net/socket";
import "./app/styles.css";

// Connect before the first render: the socket's own state machine drives the UI,
// so there is nothing to wait for and a round trip to save.
connect();

createRoot(document.getElementById("root")!).render(<App />);
