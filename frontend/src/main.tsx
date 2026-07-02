import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor?.("#0b0e14");
tg?.setBackgroundColor?.("#0b0e14");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
