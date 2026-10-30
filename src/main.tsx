import { render } from "solid-js/web";
import App from "./app/App";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./theme/style.css";
render(() => <App />, document.getElementById("root")!);
