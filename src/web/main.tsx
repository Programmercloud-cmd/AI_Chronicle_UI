import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { AppShell } from "./app-shell/app-shell";
import "./styles/global.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Chronicle root element is missing");

createRoot(root).render(
  <BrowserRouter>
    <AppShell />
  </BrowserRouter>,
);
